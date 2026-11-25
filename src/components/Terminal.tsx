import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Project } from "../types";
import { useIncoming, type Incoming } from "../lib/incoming";
import { Icon } from "./Icons";
import { ZoomBadge } from "./ZoomBadge";
import { blockDoubleClick, useZoomMotion } from "../lib/zoomPane";
import { TermView, type TermHandle } from "./TermView";

interface Props {
  tabId: string;
  /** The tab folder, once tab_sync has made it. The shell starts there. */
  dir: string | null;
  active: boolean;
  /** The tab's projects: Pull runs in each. */
  projects: Project[];
  zoomed: boolean;
  /** Hidden while a code pane is zoomed. */
  hidden: boolean;
  onZoom: () => void;
  /** More shells beside it (plain, in the tab folder), by PTY id. */
  sideTerms: string[];
  onSideTerms: (ids: string[]) => void;
}

/** The terminals' shares of the width, saved per tab (they sum to 1). */
function loadShares(tabId: string, n: number): number[] {
  try {
    const s = JSON.parse(localStorage.getItem(`fusion.termWidths.${tabId}`) || "null");
    if (Array.isArray(s) && s.length === n) return s;
  } catch {
    /* none saved */
  }
  return Array(n).fill(1 / n);
}

/** A path for the shell, in single quotes. */
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A project tab's shell. `claude` in it is the tab's wrapper (src-tauri/resources/claude.sh). */
export function Terminal({ tabId, dir, active, projects, zoomed, hidden, onZoom, sideTerms, onSideTerms }: Props) {
  const term = useRef<TermHandle | null>(null);
  const block = useZoomMotion<HTMLElement>(zoomed, hidden);
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const incoming = useIncoming(projects.map((p) => p.path), active);
  // The first terminal and the ones beside it: their widths, and the drag between two.
  const row = useRef<HTMLDivElement>(null);
  const n = sideTerms.length + 1;
  const [shares, setShares] = useState(() => loadShares(tabId, n));
  const widths = shares.length === n ? shares : Array(n).fill(1 / n);
  const saveShares = (next: number[]) => {
    setShares(next);
    try {
      localStorage.setItem(`fusion.termWidths.${tabId}`, JSON.stringify(next));
    } catch {
      /* private storage: the widths are just not remembered */
    }
  };
  const dragWidth = (i: number) => (e: React.PointerEvent) => {
    const el = row.current;
    if (!el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const start = widths.slice(0, i).reduce((a, b) => a + b, 0);
    const pair = widths[i] + widths[i + 1];
    const min = Math.min(0.1, pair / 2);
    const move = (ev: PointerEvent) => {
      const a = Math.min(pair - min, Math.max(min, (ev.clientX - r.left) / r.width - start));
      const next = [...widths];
      next[i] = a;
      next[i + 1] = pair - a;
      saveShares(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // A terminal added or closed: equal widths again.
  const setSide = (ids: string[]) => {
    saveShares(Array(ids.length + 1).fill(1 / (ids.length + 1)));
    onSideTerms(ids);
  };

  /** Types a command line into the shell and runs it, the way you would. Only when the shell
   *  itself is in front: typed into claude (or vim, or watch), it would go to that program. */
  const run = async (line: string) => {
    const states = await api.ptyStates().catch(() => null);
    const busy = states?.[tabId]?.command;
    if (busy) {
      setNote(`The terminal is busy: ${busy.split(" ")[0]}`);
      setTimeout(() => setNote(null), 3000);
      return;
    }
    api.ptyWrite(tabId, line + "\r").catch(() => {});
    term.current?.focus();
  };

  // git pull in each project, in the terminal: git's own output, with the shell's ssh agent
  // and git config. A heading names each project.
  // When the shell is in front, the pull runs in the terminal (git's own output). When it is
  // busy (claude, vim, watch), it runs out of sight instead: `git pull --ff-only`, one result
  // line per project in a panel under the button.
  const [pulled, setPulled] = useState<{ name: string; ok?: boolean; summary?: string }[] | null>(null);
  const pullTimer = useRef(0);
  const pull = async (list: Project[]) => {
    setMenu(false);
    if (list.length === 0) return;
    const states = await api.ptyStates().catch(() => null);
    if (!states?.[tabId]?.command) {
      if (list.length === 1) return run(`git -C ${sq(list[0].path)} pull`);
      const dirs = list.map((p) => sq(p.path)).join(" ");
      return run(`for d in ${dirs}; do printf '\\n\\033[1m%s\\033[0m\\n' "\${d##*/}"; git -C "$d" pull; done`);
    }
    clearTimeout(pullTimer.current);
    setPulled(list.map((p) => ({ name: p.name })));
    const results = await Promise.all(
      list.map((p) => api.gitPull(p.path).catch((e) => ({ ok: false, summary: String(e) }))),
    );
    setPulled(list.map((p, i) => ({ name: p.name, ...results[i] })));
    // All went well: the panel goes by itself. A failure stays until it is closed.
    if (results.every((r) => r.ok)) pullTimer.current = window.setTimeout(() => setPulled(null), 6000);
  };

  // ⌘⇧2: select an area of the screen: the image goes to the clipboard, and its path is pasted
  // here. xterm's paste() uses bracketed paste when the program asks for it, so claude
  // takes the path as a pasted image.
  const [snapping, setSnapping] = useState(false);
  const snap = async () => {
    if (snapping) return;
    setSnapping(true);
    try {
      const path = await api.screenshot(tabId);
      if (path) term.current?.paste(path.includes(" ") ? `"${path}" ` : `${path} `);
    } catch (e) {
      term.current?.write(`\r\n\x1b[31m${e}\x1b[0m\r\n`);
    } finally {
      setSnapping(false);
      term.current?.focus();
    }
  };
  const snapRef = useRef(snap);
  snapRef.current = snap;

  // ⌘⇧2 in the open tab. Capture phase: xterm must not see the keys first.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "Digit2") {
        e.preventDefault();
        e.stopPropagation();
        snapRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);

  return (
    <section ref={block} tabIndex={-1} onDoubleClick={blockDoubleClick(onZoom)} className="flex h-full min-h-0 flex-col overflow-hidden rounded-md tab-edge rounded-b-[var(--corner-radius)] bg-panel">
      <header className="flex h-9 shrink-0 items-center gap-2.5 border-b border-[#2b2b2b] px-3">
        <Icon name="terminal" className="h-3.5 w-3.5 text-muted" />
        {zoomed && <ZoomBadge />}
        {note && <span className="truncate text-[12px] text-[#e2c08d]">{note}</span>}
        <span className="relative ml-auto flex items-center">
          <PullButton projects={projects} incoming={incoming} open={menu} onMenu={setMenu} onPull={pull} />
          {pulled && <PullResults rows={pulled} onClose={() => setPulled(null)} />}
        </span>
        <button
          onClick={() => setSide([...sideTerms, crypto.randomUUID()])}
          title="One more terminal beside it, in the tab folder (claude there is a session of its own)"
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="splitRight" className="h-3.5 w-3.5" />
        </button>
      </header>
      <div ref={row} className="flex min-h-0 flex-1">
        <div style={{ flexGrow: widths[0], flexBasis: 0 }} className="flex min-h-0 min-w-0 flex-col">
          <TermView ptyId={tabId} plain={false} ready={dir !== null} focused={active} onHandle={(h) => (term.current = h)} />
        </div>
        {sideTerms.map((id, i) => (
          <div key={id} className="contents">
          {/* The line between two terminals: drag it to resize them. */}
          <div onPointerDown={dragWidth(i)} title="Drag to resize" className="group/grip relative z-10 -mx-[3px] flex w-[7px] shrink-0 cursor-col-resize justify-center">
            <div className="w-px bg-[#2b2b2b] transition-colors group-hover/grip:bg-white/40" />
          </div>
          <div style={{ flexGrow: widths[i + 1], flexBasis: 0 }} className="group relative flex min-h-0 min-w-0 flex-col">
            <button
              onClick={() => {
                api.ptyKill(id).catch(() => {});
                setSide(sideTerms.filter((x) => x !== id));
              }}
              title="Close this terminal"
              className="absolute right-1.5 top-1 z-10 rounded p-0.5 text-muted opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover:opacity-100"
            >
              <Icon name="close" className="h-3 w-3" />
            </button>
            <TermView ptyId={id} plain ready={dir !== null} cwd={dir ?? undefined} focused={false} />
          </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Pull, as one pill: the main part pulls every project of the tab, ▾ picks one. When the
 *  remote has commits not pulled yet, it lights up in VS Code's blue with their count. */
function PullButton({
  projects,
  incoming,
  open,
  onMenu,
  onPull,
}: {
  projects: Project[];
  incoming: Incoming;
  open: boolean;
  onMenu: (open: boolean) => void;
  onPull: (list: Project[]) => void;
}) {
  const n = incoming.total;
  const hot = n > 0;
  const none = projects.length === 0;
  const behindOf = (p: Project) => incoming.behind[p.path] ?? 0;
  const title = hot
    ? `${n} commit${n === 1 ? "" : "s"} to pull: ` +
      projects
        .filter((p) => behindOf(p) > 0)
        .map((p) => `${p.name} ↓${behindOf(p)}`)
        .join(", ")
    : incoming.checking
      ? "Checking the remote…"
      : projects.length > 1
        ? `Up to date. git pull in all ${projects.length} projects`
        : "Up to date. git pull";

  return (
    <span className="relative flex items-center">
      <span
        className={[
          "flex h-[26px] items-center overflow-hidden rounded-full transition-all duration-300",
          hot
            ? "bg-gradient-to-b from-[#0e7ae6] to-[#0062c4] text-white shadow-[0_0_0_1px_rgba(77,170,252,0.55),0_0_14px_rgba(0,120,212,0.45),inset_0_1px_0_rgba(255,255,255,0.25)]"
            : "bg-white/[0.04] text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]",
          none ? "opacity-40" : "",
        ].join(" ")}
      >
        <button
          onClick={() => onPull(projects)}
          disabled={none}
          title={title}
          className={["flex h-full items-center gap-1.5 pl-2.5 pr-2 text-[12px] font-medium transition-colors", hot ? "hover:bg-white/10" : "hover:bg-white/[0.06] hover:text-fg"].join(" ")}
        >
          <span className="relative flex h-3.5 w-3.5 items-center justify-center">
            <Icon name="pull" className={["h-3.5 w-3.5", incoming.checking ? "animate-[spin_1.2s_linear_infinite]" : ""].join(" ")} />
            {/* A soft pulse while there is something to pull. */}
            {hot && <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_6px_white] motion-safe:animate-pulse" />}
          </span>
          pull
          {hot ? (
            <span className="rounded-full bg-white px-1.5 font-mono text-[10.5px] font-semibold leading-[16px] text-[#0062c4]">↓{n}</span>
          ) : (
            !incoming.checking && !none && <Icon name="check" className="h-3 w-3 text-status-done" />
          )}
        </button>
        <span className={["h-3.5 w-px", hot ? "bg-white/30" : "bg-white/[0.12]"].join(" ")} />
        <button
          onClick={() => onMenu(!open)}
          disabled={none}
          title="Pull one project"
          className={["flex h-full items-center pl-1.5 pr-2 transition-colors", hot ? "hover:bg-white/10" : "hover:bg-white/[0.06] hover:text-fg"].join(" ")}
        >
          <Icon name="chevron" className={["h-3 w-3 transition-transform", open ? "-rotate-90" : "rotate-90"].join(" ")} />
        </button>
      </span>
      {open && (
        <div
          onMouseLeave={() => onMenu(false)}
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[200px] rounded-lg bg-card p-1 shadow-float ring-1 ring-inset ring-white/[0.2]"
        >
          {projects.length > 1 && (
            <>
              <MenuRow label="Pull all" count={n} onClick={() => onPull(projects)} />
              <div className="my-1 h-px bg-[#2b2b2b]" />
            </>
          )}
          {projects.map((p) => (
            <MenuRow key={p.path} label={p.name} count={behindOf(p)} onClick={() => onPull([p])} />
          ))}
        </div>
      )}
    </span>
  );
}

function MenuRow({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] text-text hover:bg-[#04395e]">
      <span className="truncate">{label}</span>
      {count > 0 ? (
        <span className="ml-auto rounded-full bg-[#0078d4] px-1.5 font-mono text-[10.5px] leading-[16px] text-white">↓{count}</span>
      ) : (
        <span className="ml-auto text-[11px] text-faint">up to date</span>
      )}
    </button>
  );
}

/** The background pull's results: one line per project, a spinner while it runs. */
function PullResults({ rows, onClose }: { rows: { name: string; ok?: boolean; summary?: string }[]; onClose: () => void }) {
  const done = rows.every((r) => r.ok !== undefined);
  return (
    <div className="absolute right-0 top-full z-50 mt-1.5 w-[360px] rounded-lg bg-card p-2 shadow-float ring-1 ring-inset ring-white/[0.2]">
      <div className="mb-1 flex items-center px-1 text-[11px] font-bold uppercase tracking-[0.04em] text-muted">
        {done ? "Pulled in the background" : "Pulling in the background…"}
        <button onClick={onClose} title="Close" className="ml-auto rounded p-0.5 text-faint hover:bg-hover hover:text-fg">
          <Icon name="close" className="h-3 w-3" />
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-start gap-2 rounded-md px-1 py-1 text-[12.5px]">
          {r.ok === undefined ? (
            <Icon name="pull" className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse text-[#4daafc]" />
          ) : r.ok ? (
            <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-done" />
          ) : (
            <Icon name="close" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f48771]" />
          )}
          <span className="w-28 shrink-0 truncate text-text">{r.name}</span>
          <span className={["min-w-0 break-words font-mono text-[11.5px]", r.ok === false ? "text-[#f48771]" : "text-muted"].join(" ")}>
            {r.summary ?? "…"}
          </span>
        </div>
      ))}
    </div>
  );
}
