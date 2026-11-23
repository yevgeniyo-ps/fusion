import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, Tab } from "../types";
import { tabName } from "../lib/names";
import { Icon } from "./Icons";

// The tabs in the order they were last open, newest first: Enter on an empty search goes
// back to the tab before this one, as ⌃Tab does. Kept for the app's life, not saved.
const recent: string[] = [];
export function noteOpen(id: string | null) {
  if (!id) return;
  const i = recent.indexOf(id);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(id);
}

type Row = { kind: "tab"; tab: Tab; name: string; sub: string; key: number } | { kind: "project"; project: Project };

/** Go to a tab: ⌘K or ⌘⌥P. Typing filters the tabs by their name and their projects, and
 *  lists the projects too: one opens in a new tab. */
export function TabPalette({
  tabs,
  active,
  byPath,
  projects,
  onPick,
  onOpen,
  onClose,
}: {
  tabs: Tab[];
  active: string | null;
  byPath: Map<string, Project>;
  projects: Project[];
  onPick: (id: string) => void;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const rows = useMemo<Row[]>(() => {
    const order = (tab: Tab) => {
      const i = recent.indexOf(tab.id);
      return tab.id === active ? -1 : i < 0 ? recent.length + tabs.indexOf(tab) : i;
    };
    const rank = (s: string) => (s.toLowerCase().startsWith(t) ? 0 : 1);
    const tabRows = tabs
      .map((tab, i) => {
        const names = tab.projects.map((p) => byPath.get(p)?.name ?? p.split("/").pop() ?? p);
        return { kind: "tab" as const, tab, name: tabName(tab, byPath), names, key: i };
      })
      .filter((r) => !t || [r.name, ...r.names].some((s) => s.toLowerCase().includes(t)))
      .sort((a, b) => (t ? rank(a.name) - rank(b.name) : 0) || order(a.tab) - order(b.tab))
      .map(({ names, ...r }) => ({ ...r, sub: r.tab.kind === "terminal" ? "Terminal" : names.join("  ·  ") || "No projects" }));
    const projectRows: Row[] = t
      ? projects
          .filter((p) => p.name.toLowerCase().includes(t))
          .sort((a, b) => rank(a.name) - rank(b.name))
          .slice(0, 8)
          .map((project) => ({ kind: "project", project }))
      : [];
    return [...tabRows, ...projectRows];
  }, [tabs, projects, byPath, active, t]);

  // Nothing typed: the tab before this one. Typed: the best match.
  const first = !t && rows.length > 1 && rows[0].kind === "tab" && rows[0].tab.id === active ? 1 : 0;
  const [at, setAt] = useState(first);
  useEffect(() => setAt(first), [t, first]);

  // One highlight that slides to the picked row, not one per row that blinks on and off.
  const list = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);
  const slide = useRef(false);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-row="${at}"]`);
    if (!el) return setMark(null);
    setMark({ top: el.offsetTop, height: el.offsetHeight });
    el.scrollIntoView({ block: "nearest" });
  }, [at, rows]);
  useEffect(() => {
    // The first place is set without motion; moves after it slide.
    const id = requestAnimationFrame(() => (slide.current = true));
    return () => cancelAnimationFrame(id);
  }, []);

  const go = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    if (r.kind === "tab") onPick(r.tab.id);
    else onOpen(r.project.path);
  };
  const projectsFrom = rows.findIndex((r) => r.kind === "project");

  return createPortal(
    <div className="fixed inset-0 z-[60]" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette-glass palette-in absolute left-1/2 top-[18vh] w-[min(540px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[18px]">
        <div className="flex h-[48px] items-center gap-2.5 px-4">
          <Icon name="search" className="h-[16px] w-[16px] text-white/45" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) setAt((i) => (rows.length ? (i + 1) % rows.length : 0));
              else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) setAt((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
              else if (e.key === "Enter") go(rows[at]);
              else if (e.key === "Escape") q ? setQ("") : onClose();
              else if (e.metaKey && /^[1-9]$/.test(e.key)) go(rows.find((r) => r.kind === "tab" && r.key === Number(e.key) - 1));
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
            placeholder="Go to a tab or a project"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[17px] font-light tracking-[-0.01em] text-white caret-white/80 placeholder:text-white/30 focus:outline-none"
          />
          <Key>esc</Key>
        </div>

        {rows.length > 0 && (
          <>
            <div className="palette-rule" />
            <div ref={list} className="relative max-h-[min(340px,48vh)] overflow-y-auto p-1.5">
              {mark && (
                <div
                  aria-hidden
                  className="palette-mark pointer-events-none absolute inset-x-1.5 rounded-[9px]"
                  style={{ top: mark.top, height: mark.height, transition: slide.current ? "top 140ms cubic-bezier(0.2, 0.9, 0.3, 1), height 140ms" : "none" }}
                />
              )}
              {rows.map((r, i) => (
                <div key={r.kind === "tab" ? r.tab.id : r.project.path}>
                  {i === 0 && r.kind === "tab" && <Heading text={t ? "Tabs" : "Open tabs"} />}
                  {i === projectsFrom && <Heading text="Open in a new tab" />}
                  <button
                    data-row={i}
                    onClick={() => go(r)}
                    onMouseMove={() => at !== i && setAt(i)}
                    className="relative flex h-[40px] w-full items-center gap-2.5 rounded-[9px] px-2 text-left"
                  >
                    <span className={["palette-tile flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] transition", i === at ? "palette-tile-on" : ""].join(" ")}>
                      <Icon
                        name={r.kind === "project" ? "folder" : r.tab.kind === "terminal" ? "terminal" : "spark"}
                        className={["h-[13px] w-[13px] transition-colors", i === at ? "text-white" : "text-white/70"].join(" ")}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                      <span className="truncate text-[13px] leading-[16px] text-white/90">
                        <Match text={r.kind === "tab" ? r.name : r.project.name} q={t} />
                      </span>
                      <span className="truncate text-[11px] leading-[14px] text-white/40">{r.kind === "tab" ? r.sub : r.project.path}</span>
                    </span>
                    {r.kind === "tab" && r.tab.id === active && <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 text-[10px] leading-[16px] text-white/50">Current</span>}
                    {i === at ? (
                      <Key>↩</Key>
                    ) : r.kind === "tab" && r.key < 9 ? (
                      <span className="shrink-0 px-1 text-[10.5px] tabular-nums text-white/25">⌘{r.key + 1}</span>
                    ) : null}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {rows.length === 0 && t && (
          <>
            <div className="palette-rule" />
            <div className="px-4 py-5 text-center text-[12px] text-white/40">No tab or project matches “{q.trim()}”.</div>
          </>
        )}
        <div className="flex h-[30px] items-center gap-3.5 bg-black/[0.18] px-4 text-[10.5px] text-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <span className="flex items-center gap-1.5"><Key>↑</Key><Key>↓</Key> move</span>
          <span className="flex items-center gap-1.5"><Key>↩</Key> open</span>
          <span className="flex items-center gap-1.5"><Key>⌘</Key><Key>1–9</Key> tab</span>
          <span className="ml-auto flex items-center gap-1.5"><Key>⌘</Key><Key>K</Key></span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The name with the typed part brighter and bolder. */
function Match({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="font-semibold text-white">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="palette-key inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-[4px] px-1 font-sans text-[10px] leading-none text-white/55">{children}</kbd>;
}

function Heading({ text }: { text: string }) {
  return <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold tracking-[0.02em] text-white/35">{text}</div>;
}
