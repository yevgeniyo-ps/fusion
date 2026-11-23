import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { api } from "../api";
import type { Project, Tab } from "../types";
import { Pane } from "./Pane";
import { Terminal } from "./Terminal";
import { ProjectTerminal } from "./ProjectTerminal";
import { Grip } from "./Grip";

interface Props {
  tab: Tab;
  name: string;
  projects: Project[];
  active: boolean;
  split: number;
  onSplit: (split: number) => void;
  onRemove: (path: string) => void;
  onWidths: (widths: number[]) => void;
}

/** One tab: a pane per project side by side, the terminal under them. Hidden tabs stay
 *  mounted, so their shells and editors keep running. */
export function Workspace({ tab, name, projects, active, split, onSplit, onRemove, onWidths }: Props) {
  const { isOver, setNodeRef } = useDroppable({ id: `ws:${tab.id}` });
  const [dir, setDir] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // A double-click on a block's header fills the tab with it ("terminal" or a project's
  // path); again, the layout comes back. The others stay mounted, so they keep running.
  const [zoomRaw, setZoom] = useState<string | null>(null);
  const zoom = zoomRaw === "terminal" || projects.some((p) => p.path === zoomRaw) ? zoomRaw : null;
  const toggle = (id: string) => setZoom((z) => (z === id ? null : id));
  const codeZoomed = zoom !== null && zoom !== "terminal";
  // A zoomed project gets its own terminal under it, opened at once. Once opened, a project's
  // terminal keeps running while the tab is open, shown again each time the project is zoomed.
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => {
    if (codeZoomed && zoom && !opened.includes(zoom)) setOpened((o) => [...o, zoom]);
  }, [codeZoomed, zoom, opened]);
  const termProjects = projects.filter((p) => opened.includes(p.path));

  // Each change to the set of projects rewrites the tab folder (and restarts the tab's claude).
  const key = projects.map((p) => p.path).join("\n");
  useEffect(() => {
    api.tabSync(tab.id, name, projects.map((p) => ({ name: p.name, path: p.path }))).then(setDir, console.error);
    // key and name cover projects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, key, name]);

  // The panes' widths: saved per tab; equal when the number of projects changed.
  const codeBox = useRef<HTMLDivElement>(null);
  const widths = tab.widths?.length === projects.length ? tab.widths : projects.map(() => 1 / Math.max(1, projects.length));
  const dragWidth = (i: number) => (e: React.PointerEvent) => {
    const el = codeBox.current;
    if (!el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const start = widths.slice(0, i).reduce((a, b) => a + b, 0);
    const pair = widths[i] + widths[i + 1];
    const min = Math.min(0.12, pair / 2);
    const move = (ev: PointerEvent) => {
      const a = Math.min(pair - min, Math.max(min, (ev.clientX - r.left) / r.width - start));
      const next = [...widths];
      next[i] = a;
      next[i + 1] = pair - a;
      onWidths(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startDrag = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => onSplit(Math.min(0.85, Math.max(0.2, (ev.clientY - r.top) / r.height)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    // A black frame; each block has a white edge (.tab-edge).
    <div
      ref={box}
      className={active ? "absolute inset-0 flex flex-col p-1.5" : "hidden"}
    >
      <div
        ref={(el) => {
          setNodeRef(el);
          codeBox.current = el;
        }}
        style={{ height: `${split * 100}%` }}
        className={["flex min-h-0 shrink-0 rounded-md transition", isOver ? "ring-2 ring-white/70" : "", zoom === "terminal" ? "hidden" : ""].join(" ")}
      >
        {/* Side by side, a 16px gap with a grip line between each two: drag it to share
            the width differently. A zoomed pane takes the whole row. */}
        {projects.map((p, i) => {
          const hidden = zoom !== null && zoom !== p.path;
          return (
            <div key={p.path} className="contents">
              <div style={{ flexGrow: codeZoomed ? 1 : widths[i], flexBasis: 0 }} className={["flex min-w-0", hidden ? "hidden" : ""].join(" ")}>
                <Pane
                  project={p}
                  onRemove={() => onRemove(p.path)}
                  zoomed={zoom === p.path}
                  hidden={hidden}
                  live={active}
                  onZoom={() => toggle(p.path)}
                />
              </div>
              {i < projects.length - 1 && !zoom && (
                <div onPointerDown={dragWidth(i)} className="group flex w-4 shrink-0 cursor-col-resize items-center justify-center">
                  <Grip vertical />
                </div>
              )}
            </div>
          );
        })}
        {projects.length === 0 && (
          // A dark block with a white edge, as a pane is. Dragging a project over it
          // shows the white ring of the drop area (above).
          <div className="tab-edge flex flex-1 flex-col items-center justify-center gap-2 rounded-md bg-panel text-center">
            <span className="text-[13px] text-text">Drop projects here</span>
            <span className="text-[12px] text-muted">Each project gets a pane. The terminal and Claude see all of them.</span>
          </div>
        )}
      </div>
      {/* The gap between code and terminal: 16px, with a grip line to drag. */}
      <div onPointerDown={startDrag} className={["group flex h-4 shrink-0 cursor-row-resize items-center justify-center", zoom === "terminal" ? "hidden" : ""].join(" ")}>
        <Grip />
      </div>
      {/* Under a zoomed project: its own terminal. */}
      {termProjects.length > 0 && (
        <div className={["min-h-0 flex-1", codeZoomed ? "" : "hidden"].join(" ")}>
          {termProjects.map((p) => (
            <ProjectTerminal key={p.path} tabId={tab.id} project={p} shown={active && zoom === p.path} />
          ))}
        </div>
      )}
      <div className={["min-h-0 flex-1", codeZoomed ? "hidden" : ""].join(" ")}>
        <Terminal tabId={tab.id} dir={dir} active={active} projects={projects} zoomed={zoom === "terminal"} hidden={codeZoomed} onZoom={() => toggle("terminal")} />
      </div>
    </div>
  );
}
