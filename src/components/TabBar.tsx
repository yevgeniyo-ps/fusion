import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Project, Tab } from "../types";
import { tabName } from "../lib/names";
import { useFullscreen } from "../lib/fullscreen";
import { Icon } from "./Icons";

interface Props {
  tabs: Tab[];
  active: string | null;
  byPath: Map<string, Project>;
  sidebarOpen: boolean;
  onUnfold: () => void;
  onPick: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onNewTerm: () => void;
  onNewNote: () => void;
  onRename: (id: string, name: string) => void;
  /** Tabs where claude thinks, and where it finished (not opened since): a dot on each. */
  busy?: Set<string>;
  finished?: Set<string>;
  /** The Claude activity animation, beside the tabs. */
  activity?: React.ReactNode;
}

/** The mixes, as pills on one track. Each pill and the + take a dropped project.
 *  The open tab has a white edge, as its blocks have. */
export function TabBar({ tabs, active, byPath, sidebarOpen, onUnfold, onPick, onClose, onNew, onNewTerm, onNewNote, onRename, busy, finished, activity }: Props) {
  const fullscreen = useFullscreen();
  return (
    <div
      data-tauri-drag-region
      // The left edge lines up with the blocks below (Workspace pl-2), except where the
      // window's traffic lights are: sidebar folded and not full screen.
      className={["flex h-[52px] shrink-0 items-center gap-3 pr-3", sidebarOpen || fullscreen ? "pl-2" : "pl-[84px]"].join(" ")}
    >
      {!sidebarOpen && (
        // 8px up: level with the window's traffic lights, which sit above the strip's middle.
        <button onClick={onUnfold} title="Show projects  [" className="-translate-y-2 rounded-md p-1.5 text-white/50 hover:bg-hover hover:text-fg">
          <Icon name="chevrons" className="h-3.5 w-3.5" />
        </button>
      )}
      {/* The tab pill stays black on the grey window. */}
      <div className="lg-glass flex h-9 min-w-0 items-center gap-1 rounded-full !bg-black p-1">
        <TabStrip active={active}>
          {tabs.map((t, i) => (
            <TabPill
              key={t.id}
              tab={t}
              index={i}
              name={tabName(t, byPath)}
              on={t.id === active}
              onPick={() => onPick(t.id)}
              onClose={() => onClose(t.id)}
              onRename={(n) => onRename(t.id, n)}
              claude={busy?.has(t.id) ? "busy" : finished?.has(t.id) ? "done" : null}
            />
          ))}
        </TabStrip>
        <NewTabPill onNew={onNew} onNewTerm={onNewTerm} onNewNote={onNewNote} />
        <AllTabs tabs={tabs} active={active} byPath={byPath} onPick={onPick} />
      </div>
      {/* The Claude activity, in the window's top right corner. */}
      {activity && <div className="ml-auto flex shrink-0">{activity}</div>}
    </div>
  );
}

function TabPill({
  tab,
  index,
  name,
  on,
  onPick,
  onClose,
  onRename,
  claude,
}: {
  tab: Tab;
  index: number;
  name: string;
  on: boolean;
  onPick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  claude: "busy" | "done" | null;
}) {
  // A drop target (a project, or another tab to put beside it) and draggable (to move it).
  const { isOver, setNodeRef: setDrop } = useDroppable({ id: `tab:${tab.id}` });
  const { attributes, listeners, setNodeRef: setDrag, isDragging } = useDraggable({ id: `tabdrag:${tab.id}`, data: { tabId: tab.id } });
  const setNodeRef = (el: HTMLElement | null) => {
    setDrop(el);
    setDrag(el);
  };
  const [editing, setEditing] = useState(false);
  // The open tab: a dark pill with a white edge, as its blocks have.
  const style = on ? { boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.85), 0 2px 8px rgba(0,0,0,0.35)" } : undefined;
  return (
    <div
      ref={setNodeRef}
      data-tab={tab.id}
      {...(editing ? {} : { ...attributes, ...listeners })}
      onClick={onPick}
      onDoubleClick={() => setEditing(true)}
      title={index < 9 ? `⌘${index + 1} · drag to move · double-click to rename` : "Drag to move · double-click to rename"}
      style={isOver ? undefined : style}
      className={[
        "group relative flex h-7 min-w-[84px] max-w-[320px] flex-[0_1_auto] cursor-default items-center justify-center gap-2 rounded-full border px-3.5 text-[13px] font-medium tracking-[-0.01em] transition-colors duration-300",
        on ? "border-transparent bg-panel text-white" : "border-transparent text-white/60 hover:text-white/90",
        isOver ? "bg-accent/15 text-white ring-1 ring-inset ring-accent/70" : "",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={tab.name ?? ""}
          placeholder={name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            onRename(e.currentTarget.value.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-40 bg-transparent text-white outline-none placeholder:text-white/40"
        />
      ) : (
        <span className="min-w-0 truncate">{name}</span>
      )}
      {/* Claude thinks here (orange, breathing) or finished here (green). */}
      {claude && (
        <span
          title={claude === "busy" ? "Claude is brewing here" : "Claude finished here"}
          className={["h-1.5 w-1.5 shrink-0 rounded-full", claude === "busy" ? "tab-brewing bg-[#d97757]" : "bg-status-done shadow-[0_0_6px_rgba(108,209,123,0.8)]"].join(" ")}
        />
      )}
      {!tab.kind && (
        <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 font-mono text-[10.5px] text-white/60">{tab.projects.length}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close tab"
        // Over the pill's right end, on hover only: it takes no room, so the name sits centred.
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-[#1c1d20] p-1 text-white/50 opacity-0 hover:bg-[#2a2b2f] hover:text-white group-hover:opacity-100"
      >
        <Icon name="close" className="h-3 w-3" />
      </button>
    </div>
  );
}

/** + : a menu of what to open (a project tab, a terminal, a text page). A project dropped on
 *  it opens a new tab with it. */
function NewTabPill({ onNew, onNewTerm, onNewNote }: { onNew: () => void; onNewTerm: () => void; onNewNote: () => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: "newtab" });
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const btn = useRef<HTMLButtonElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const items: { icon: "folder" | "terminal" | "note"; label: string; keys: string; run: () => void }[] = [
    { icon: "folder", label: "Project tab", keys: "⌘T", run: onNew },
    { icon: "terminal", label: "Terminal", keys: "⌘⇧T", run: onNewTerm },
    { icon: "note", label: "Text", keys: "⌘N", run: onNewNote },
  ];
  useEffect(() => {
    if (!open) return;
    setAt(0);
    box.current?.focus();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);
  const pick = (i: number) => {
    setOpen(false);
    items[i].run();
  };
  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button
        ref={(n) => {
          btn.current = n;
          setNodeRef(n);
        }}
        onClick={() => setOpen((o) => !o)}
        title="New…  ⌘T project tab · ⌘⇧T terminal · ⌘N text · drop a project here for a new mix"
        className={[
          "flex h-7 shrink-0 items-center rounded-full px-2.5 text-white/50 transition hover:text-white",
          open ? "bg-white/10 text-white" : "",
          isOver ? "bg-accent/15 text-white ring-1 ring-inset ring-accent/70" : "",
        ].join(" ")}
      >
        <Icon name="plus" className="h-3.5 w-3.5" />
      </button>
      {/* In the page's body, as the tab list (AllTabs): the track's backdrop-filter would
          place a "fixed" menu far from the button. */}
      {open && r && createPortal(
        <div
          ref={box}
          tabIndex={-1}
          role="menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") setAt((i) => (i + 1) % items.length);
            else if (e.key === "ArrowUp") setAt((i) => (i - 1 + items.length) % items.length);
            else if (e.key === "Enter") pick(at);
            else return;
            e.preventDefault();
          }}
          style={{ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 228)) }}
          className="fixed z-50 w-[220px] rounded-lg bg-card p-1 shadow-float outline-none ring-1 ring-inset ring-white/[0.2]"
        >
          {items.map((it, i) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => pick(i)}
              onMouseEnter={() => setAt(i)}
              className={["flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]", i === at ? "bg-[#04395e] text-white" : "text-text"].join(" ")}
            >
              <Icon name={it.icon} className="h-3.5 w-3.5 shrink-0 text-muted" />
              {it.label}
              <span className="ml-auto font-mono text-[11px] text-muted">{it.keys}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** The pills, each as wide as its name (up to 320px), shrinking only when they do not fit; past their smallest, the strip scrolls (wheel or trackpad),
 *  with a fade on the side that has more. The open tab is kept in view. */
function TabStrip({ active, children }: { active: string | null; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  // A new state only when an edge changes: a new object each time would render again, and
  // the observers below would measure again, without end.
  const measure = () => {
    const el = box.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  };
  // Once: the strip's size (window, sidebar) and its content (tabs added, closed, renamed).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    box.current?.querySelector(`[data-tab="${active}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [active]);
  const fade = `linear-gradient(to right, ${edges.left ? "transparent, black 24px" : "black"}, ${edges.right ? "black calc(100% - 24px), transparent" : "black"})`;
  return (
    <div
      ref={box}
      onScroll={measure}
      // A mouse wheel turns vertically: here it moves the strip sideways.
      onWheel={(e) => {
        if (box.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) box.current.scrollLeft += e.deltaY;
      }}
      style={{ maskImage: fade, WebkitMaskImage: fade }}
      className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
    >
      {children}
    </div>
  );
}

/** Every tab in a list, with a filter, as Chrome's tab search: the ▾ at the end, or ⌘⇧A.
 *  (⌘K and ⌘⌥P open TabPalette, in the middle of the window.) */
function AllTabs({ tabs, active, byPath, onPick }: { tabs: Tab[]; active: string | null; byPath: Map<string, Project>; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "KeyA") {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setAt(0);
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);
  const t = q.trim().toLowerCase();
  // A tab matches by its name or by the name of one of its projects.
  const list = tabs
    .map((tab) => ({ tab, name: tabName(tab, byPath) }))
    .filter((x) => !t || [x.name, ...x.tab.projects.map((p) => byPath.get(p)?.name ?? p)].some((s) => s.toLowerCase().includes(t)));
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
  };
  const r = btn.current?.getBoundingClientRect();
  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        title={`All tabs (${tabs.length})  ⌘⇧A · go to a tab ⌘K`}
        className={["flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-white/50 transition hover:text-white", open ? "bg-white/10 text-white" : ""].join(" ")}
      >
        <Icon name="chevron" className="h-3 w-3 rotate-90" />
        <span className="font-mono text-[11px]">{tabs.length}</span>
      </button>
      {/* In the page's body: the tab track's backdrop-filter would make it the box that a
          "fixed" list is placed in, and the list would open far from the button. */}
      {open && r && createPortal(
        <div
          ref={box}
          style={{ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }}
          className="fixed z-50 w-[min(480px,calc(100vw-32px))] rounded-lg bg-card p-1.5 shadow-float ring-1 ring-inset ring-white/[0.2]"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") setAt((i) => Math.min(list.length - 1, i + 1));
              else if (e.key === "ArrowUp") setAt((i) => Math.max(0, i - 1));
              else if (e.key === "Enter" && list[at]) pick(list[at].tab.id);
              else return;
              e.preventDefault();
            }}
            placeholder="Search tabs"
            spellCheck={false}
            className="mb-1 h-[26px] w-full rounded-[4px] border border-[#3c3c3c] bg-[#313131] px-2 text-[13px] text-text placeholder:text-[#989898] focus:border-[#0078d4] focus:outline-none"
          />
          <div className="max-h-[360px] overflow-y-auto">
            {list.map(({ tab, name }, i) => (
              <button
                key={tab.id}
                onClick={() => pick(tab.id)}
                onMouseEnter={() => setAt(i)}
                className={["flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]", i === at ? "bg-[#04395e] text-white" : "text-text"].join(" ")}
              >
                <span className="w-3.5 shrink-0">{tab.id === active && <Icon name="check" className="h-3.5 w-3.5" />}</span>
                {tab.kind && <Icon name={tab.kind} className="h-3.5 w-3.5 shrink-0 text-muted" />}
                <span className="truncate">{name}</span>
                {!tab.kind && <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{tab.projects.length}</span>}
              </button>
            ))}
            {list.length === 0 && <div className="px-2 py-2 text-[12px] text-muted">No tab matches.</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
