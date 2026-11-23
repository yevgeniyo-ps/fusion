import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Split, Tab } from "../types";
import { layout, leaf, leaves, remove, resize, splitAt, type Box, type Edges, type Laid } from "../lib/splits";
import { Icon } from "./Icons";
import { TermView, type TermHandle } from "./TermView";
import { ZoomBadge } from "./ZoomBadge";
import { SessionName } from "./SessionName";
import { TokenBadge } from "./TokenBadge";
import { useClaudeUsage } from "../lib/usage";
import { Grip } from "./Grip";
import { blockDoubleClick, useZoomMotion } from "../lib/zoomPane";

interface Props {
  tab: Tab;
  active: boolean;
  onChange: (term: Split) => void;
  /** The last shell closed: the tab closes too, as in iTerm. */
  onEmpty: () => void;
}

/** A terminal tab: plain shells, split as iTerm splits them.
 *  ⌘D splits right, ⌘⇧D splits down, ⌘] and ⌘[ go to the next or previous pane,
 *  ⌘⇧↩ (or a double-click on its header) makes the pane fill the tab, and back. */
export function TermTab({ tab, active, onChange, onEmpty }: Props) {
  const tree = tab.term!;
  const ids = leaves(tree);
  const [focus, setFocus] = useState(ids[0]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const handles = useRef<Record<string, TermHandle | null>>({});
  const current = ids.includes(focus) ? focus : ids[0];
  // One pane can fill the tab (double-click its header, or ⌘⇧↩); the others stay mounted.
  const [zoomRaw, setZoom] = useState<string | null>(null);
  const zoom = zoomRaw && ids.includes(zoomRaw) ? zoomRaw : null;
  const toggleZoom = (id: string) => setZoom((z) => (z === id ? null : id));

  const split = (id: string, dir: "row" | "col") => {
    const fresh = leaf();
    // A new pane must be seen: a split ends the zoom.
    setZoom(null);
    onChange(splitAt(tree, id, dir, fresh));
    if (fresh.kind === "term") setFocus(fresh.id);
  };
  const close = (id: string) => {
    api.ptyKill(id).catch(() => {});
    const next = remove(tree, id);
    if (!next) return onEmpty();
    const i = ids.indexOf(id);
    onChange(next);
    if (id === current) setFocus(ids[i + 1] ?? ids[i - 1]);
  };
  const move = (step: number) => {
    const i = ids.indexOf(current);
    const next = ids[(i + step + ids.length) % ids.length];
    setFocus(next);
    handles.current[next]?.focus();
  };

  // The latest actions for the key handler, which stays the same while the tab is open.
  const keys = useRef({ split, move, current, toggleZoom });
  keys.current = { split, move, current, toggleZoom };
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keys.current;
      let done = true;
      if (e.code === "KeyD") k.split(k.current, e.shiftKey ? "col" : "row");
      else if (e.code === "BracketRight" && !e.shiftKey) k.move(1);
      else if (e.code === "BracketLeft" && !e.shiftKey) k.move(-1);
      else if (e.code === "Enter" && e.shiftKey) k.toggleZoom(k.current);
      else done = false;
      if (done) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture phase: xterm must not see the keys first.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);

  const laid = layout(tree);
  const area = useRef<HTMLDivElement>(null);
  const pct = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });

  // Drag a divider: the two parts beside it share their space differently.
  const drag = (d: Laid["dividers"][number]) => (e: React.PointerEvent) => {
    const el = area.current;
    if (!el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const row = d.dir === "row";
    const start = d.sizes.slice(0, d.i).reduce((a, b) => a + b, 0);
    const pair = d.sizes[d.i] + d.sizes[d.i + 1];
    const min = Math.min(0.08, pair / 2);
    const moveTo = (ev: PointerEvent) => {
      // The pointer as a share of the split's own box.
      const at = row ? ((ev.clientX - r.left) / r.width - d.box.x) / d.box.w : ((ev.clientY - r.top) / r.height - d.box.y) / d.box.h;
      const a = Math.min(pair - min, Math.max(min, at - start));
      const sizes = [...d.sizes];
      sizes[d.i] = a;
      sizes[d.i + 1] = pair - a;
      onChange(resize(treeRef.current, d.path, sizes));
    };
    const up = () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", up);
  };
  const treeRef = useRef(tree);
  treeRef.current = tree;

  return (
    // A black frame, a white edge on each pane, as in a project tab. Each pane has an 8px
    // margin, so two panes are 16px apart (a grip line between them); the box reaches 2px
    // past the tab on each side, so a pane is 6px from the window edge, as in a project tab.
    <div className={active ? "absolute -inset-0.5" : "hidden"}>
      <div ref={area} className="relative h-full w-full">
        {laid.panes.map((p) => (
          <div
            key={p.id}
            style={pct(zoom === p.id ? { x: 0, y: 0, w: 1, h: 1 } : p.box)}
            className={["absolute flex p-2", zoom && zoom !== p.id ? "hidden" : ""].join(" ")}
          >
            <TermPane
              id={p.id}
              title={titles[p.id]}
              focused={active && p.id === current}
              edges={zoom === p.id ? { bottom: true, left: true, right: true } : p.edges}
              onFocus={() => setFocus(p.id)}
              onTitle={(t) => setTitles((all) => ({ ...all, [p.id]: t }))}
              onHandle={(h) => (handles.current[p.id] = h)}
              onSplit={(dir) => split(p.id, dir)}
              onClose={() => close(p.id)}
              zoomed={zoom === p.id}
              hidden={!!zoom && zoom !== p.id}
              live={active}
              onZoom={() => {
                setFocus(p.id);
                toggleZoom(p.id);
              }}
            />
          </div>
        ))}
        {!zoom && laid.dividers.map((d) => {
          const row = d.dir === "row";
          const line = row ? d.box.x + d.at * d.box.w : d.box.y + d.at * d.box.h;
          const style = row
            ? { left: `calc(${line * 100}% - 8px)`, top: `${d.box.y * 100}%`, width: 16, height: `${d.box.h * 100}%` }
            : { top: `calc(${line * 100}% - 8px)`, left: `${d.box.x * 100}%`, height: 16, width: `${d.box.w * 100}%` };
          return (
            <div
              key={`${d.path.join(".")}:${d.i}`}
              onPointerDown={drag(d)}
              style={style}
              className={["group absolute z-10 flex items-center justify-center", row ? "cursor-col-resize" : "cursor-row-resize"].join(" ")}
            >
              <Grip vertical={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TermPane({
  id,
  title,
  focused,
  edges,
  onFocus,
  onTitle,
  onHandle,
  onSplit,
  onClose,
  zoomed,
  hidden,
  live,
  onZoom,
}: {
  id: string;
  title?: string;
  focused: boolean;
  edges: Edges;
  onFocus: () => void;
  onTitle: (t: string) => void;
  onHandle: (h: TermHandle | null) => void;
  onSplit: (dir: "row" | "col") => void;
  onClose: () => void;
  zoomed: boolean;
  hidden: boolean;
  /** Its tab is open: only then is the token count read. */
  live: boolean;
  onZoom: () => void;
}) {
  const block = useZoomMotion<HTMLElement>(zoomed, hidden);
  const { usage, running: claudeRuns } = useClaudeUsage(id, true, live && !hidden);
  const fit = "calc(var(--window-radius) - var(--frame-gap))";
  return (
    <section
      ref={block}
      onPointerDown={onFocus}
      onDoubleClick={blockDoubleClick(onZoom)}
      style={{
        borderBottomLeftRadius: edges.bottom && edges.left ? fit : undefined,
        borderBottomRightRadius: edges.bottom && edges.right ? fit : undefined,
      }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md tab-edge bg-panel"
    >
      <header className="group flex h-7 shrink-0 items-center gap-2 border-b border-[#2b2b2b] px-2">
        <button onClick={onClose} title="Close this pane" className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg">
          <Icon name="close" className="h-3 w-3" />
        </button>
        <SessionName id={id} fallback={title || "shell"} className={["text-[12px]", focused ? "text-[#e7e7e7]" : "text-muted"].join(" ")} />
        <TokenBadge usage={usage} running={claudeRuns} />
        {zoomed && <ZoomBadge />}
        <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={() => onSplit("row")} title="Split right  ⌘D" className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <Icon name="splitRight" className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onSplit("col")} title="Split down  ⌘⇧D" className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
            <Icon name="splitDown" className="h-3.5 w-3.5" />
          </button>
        </span>
      </header>
      <TermView ptyId={id} plain ready focused={focused} onHandle={onHandle} onTitle={onTitle} onFocus={onFocus} />
      {/* The panes you are not in are dimmed, as in iTerm. */}
      {!focused && <div className="pointer-events-none absolute inset-0 top-7 bg-black/25" />}
    </section>
  );
}
