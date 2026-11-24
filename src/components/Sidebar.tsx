import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import type { Project, ProjectGroup } from "../types";
import { tildify } from "../lib/names";
import { GROUP_COLORS, moveTo, nextGroupColor, sortGroup, sortGroups } from "../lib/groups";
import { Icon, Wordmark } from "./Icons";

interface Props {
  projects: Project[];
  home: string | null;
  groups: ProjectGroup[];
  onGroups: (groups: ProjectGroup[]) => void;
  onFold: () => void;
  onClone: () => void;
  onAddFolder: () => void;
  onImport: () => void;
  onSettings: () => void;
  /** Removes projects from Fusion (and from the tabs that have them); their folders stay. */
  onRemove: (ps: Project[]) => void;
  /** A new tab with these projects. */
  onOpen: (paths: string[]) => void;
}

/** The checkouts. Drag one onto a tab, onto the open tab's panes, or onto + for a new tab.
 *  Groups, as Chrome's tab groups: a coloured name, folded or open; drag a project onto a
 *  group's header to move it in, onto a member to place it there, onto Ungrouped to take it
 *  out. A click picks a project; with some picked, a bar opens them in a new tab, groups or
 *  removes them. Select adds checkboxes and All, for many at once. */
export function Sidebar({ projects, home, groups, onGroups, onFold, onClone, onAddFolder, onImport, onSettings, onRemove, onOpen }: Props) {
  const [q, setQ] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  // The group whose menu is open, and where its header is; a new group opens it at once.
  const [menu, setMenu] = useState<{ id: string; at: DOMRect } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const t = q.trim().toLowerCase();
  const matches = (p: Project) => !t || `${p.name} ${p.path}`.toLowerCase().includes(t);
  const byPath = new Map(projects.map((p) => [p.path, p]));
  const grouped = new Set(groups.flatMap((g) => g.paths));
  const ungrouped = projects.filter((p) => !grouped.has(p.path) && matches(p));
  const shownCount = ungrouped.length + groups.reduce((n, g) => n + g.paths.filter((p) => byPath.has(p) && matches(byPath.get(p)!)).length, 0);
  const shownPaths = [...groups.flatMap((g) => g.paths.filter((p) => byPath.has(p) && matches(byPath.get(p)!))), ...ungrouped.map((p) => p.path)];

  const stop = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  // Esc leaves selection, and drops the picks.
  const active = selecting || picked.size > 0;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stop();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const toggle = (path: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(path)) n.add(path);
      return n;
    });
  const allShown = shownPaths.length > 0 && shownPaths.every((p) => picked.has(p));
  const pickAll = () =>
    setPicked((s) => {
      const n = new Set(s);
      for (const p of shownPaths) allShown ? n.delete(p) : n.add(p);
      return n;
    });
  // The picked projects in a new tab, in the order the sidebar shows them.
  const openTab = () => {
    onOpen(shownPaths.filter((p) => picked.has(p)).concat([...picked].filter((p) => !shownPaths.includes(p))));
    stop();
  };
  const remove = () => {
    onRemove(projects.filter((p) => picked.has(p.path)));
    stop();
  };
  // A new group of the picked projects; its menu opens, to name it.
  const group = () => {
    const id = crypto.randomUUID();
    const paths = shownPaths.filter((p) => picked.has(p));
    const next: ProjectGroup = { id, name: "", color: nextGroupColor(groups), paths: [] };
    onGroups(moveTo([...groups, next], paths, id));
    setFresh(id);
    stop();
  };
  const patch = (id: string, change: Partial<ProjectGroup>) => onGroups(groups.map((g) => (g.id === id ? { ...g, ...change } : g)));

  const row = (p: Project, groupId?: string) =>
    selecting ? (
      <SelectableProject key={p.path} project={p} home={home} picked={picked.has(p.path)} onToggle={() => toggle(p.path)} />
    ) : (
      <DraggableProject key={p.path} project={p} home={home} groupId={groupId} picked={picked.has(p.path)} onToggle={() => toggle(p.path)} />
    );

  const open = menu ? groups.find((g) => g.id === menu.id) : undefined;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/[0.12] bg-panel/80">
      {/* The window's traffic lights sit in this strip; it also drags the window. */}
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-end px-3">
        <button onClick={onFold} title="Hide projects  [" className="rounded-md p-1.5 text-white/40 hover:bg-hover hover:text-fg">
          <Icon name="chevrons" className="h-3.5 w-3.5 rotate-180" />
        </button>
      </div>
      <div className="px-4 pb-8">
        <Wordmark />
      </div>
      {/* The section header, as VS Code's Explorer has it: the name, then its actions. */}
      <div className="group/head flex h-[22px] items-center gap-1 pl-4 pr-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-text">Projects</span>
        <span className="font-mono text-[11px] text-muted">{projects.length}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <HeadButton icon="github" title="Import from GitHub…  pick repos of an org" onClick={onImport} />
          <HeadButton icon="clone" title="Clone Repository…  ⌘⇧C" onClick={onClone} />
          <HeadButton icon="folderPlus" title="Add Folder…  ⌘O" onClick={onAddFolder} />
          {projects.length > 0 && (
            <HeadButton
              icon="select"
              title={selecting ? "Stop selecting  Esc" : "Select projects: group them, or remove several at once"}
              onClick={selecting ? stop : () => setSelecting(true)}
              on={selecting}
            />
          )}
        </span>
      </div>
      {projects.length > 0 && (
        <div className="px-3 pb-1.5 pt-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter"
            spellCheck={false}
            className="h-[26px] w-full rounded-[4px] border border-[#3c3c3c] bg-[#313131] px-2 text-[13px] text-text placeholder:text-[#989898] focus:border-[#0078d4] focus:outline-none"
          />
        </div>
      )}
      {selecting && (
        <label className="mx-2.5 mb-1 flex h-[24px] shrink-0 cursor-pointer items-center gap-2 px-2.5 text-[12px] text-muted">
          <input type="checkbox" checked={allShown} onChange={pickAll} className="accent-white" />
          All{t ? " shown" : ""}
        </label>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-2">
        {groups.map((g) => {
          const members = g.paths.map((p) => byPath.get(p)).filter((p): p is Project => !!p && matches(p));
          // Filtering: a group without a match goes out of sight, one with matches opens.
          if (t && members.length === 0) return null;
          const folded = !!g.collapsed && !t;
          return (
            <div key={g.id} className="flex flex-col gap-1">
              <GroupHeader
                group={g}
                count={g.paths.filter((p) => byPath.has(p)).length}
                folded={folded}
                autoMenu={fresh === g.id}
                onToggle={() => patch(g.id, { collapsed: !g.collapsed })}
                onMenu={(at) => {
                  setFresh(null);
                  setMenu({ id: g.id, at });
                }}
              />
              {!folded && members.length > 0 && (
                <div className="ml-1.5 flex flex-col gap-1 border-l-2 pl-1.5" style={{ borderColor: g.color }}>
                  {members.map((p) => row(p, g.id))}
                </div>
              )}
            </div>
          );
        })}
        {groups.length > 0 && <UngroupedHeader hasProjects={ungrouped.length > 0} />}
        {ungrouped.map((p) => row(p))}
        {projects.length === 0 && (
          // No projects: VS Code's empty Explorer, a line of text and full-width buttons.
          <div className="flex flex-col gap-3 px-3 pt-2 text-[13px] leading-relaxed text-text">
            <p>No projects yet. Clone a repository, or add a folder that is already on this Mac.</p>
            <button onClick={onClone} className="h-[26px] rounded-[4px] bg-[#0078d4] text-[13px] text-white hover:bg-[#026ec1]">
              Clone Repository
            </button>
            <button onClick={onAddFolder} className="h-[26px] rounded-[4px] bg-[#313131] text-[13px] text-text hover:bg-[#3c3c3c]">
              Add Folder
            </button>
            <button onClick={onImport} className="h-[26px] rounded-[4px] bg-[#313131] text-[13px] text-text hover:bg-[#3c3c3c]">
              Import from GitHub
            </button>
          </div>
        )}
        {projects.length > 0 && shownCount === 0 && <p className="px-2 pt-2 text-[13px] text-muted">No project matches “{q.trim()}”.</p>}
      </div>
      {/* Selection: what to do with the picked projects. Their folders stay on disk. The count
          stands above the buttons, so they stay one short word each and fit the panel. */}
      {active && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-[#2b2b2b] px-3 pb-3 pt-2">
          <div className="flex items-center text-[12px] text-muted">
            {picked.size === 0 ? "Pick projects to open, group or remove" : `${picked.size} selected`}
            <button onClick={stop} title="Esc" className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg">
              {selecting ? "Cancel" : "Clear"}
            </button>
          </div>
          <button
            onClick={openTab}
            disabled={picked.size === 0}
            title="A new tab with the selected projects"
            className="glass-btn glass-btn-main h-[30px] w-full whitespace-nowrap rounded-full text-[13px] font-medium"
          >
            Open in new tab
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={group}
              disabled={picked.size === 0}
              title="Put the selected projects in a new group"
              className="glass-btn h-[28px] flex-1 whitespace-nowrap rounded-full text-[13px]"
            >
              Group
            </button>
            <button
              onClick={remove}
              disabled={picked.size === 0}
              title="Out of Fusion and its tabs. The folders and repos stay on disk."
              className="glass-btn glass-btn-danger h-[28px] flex-1 whitespace-nowrap rounded-full text-[13px]"
            >
              Remove
            </button>
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center border-t border-white/[0.12] px-2.5 py-1.5">
        <HeadButton icon="settings" title="Settings" onClick={onSettings} />
      </div>
      {menu && open && (
        <GroupMenu
          group={open}
          at={menu.at}
          onChange={(change) => patch(open.id, change)}
          onSort={() => onGroups(sortGroup(groups, open.id, (p) => byPath.get(p)?.name ?? p))}
          onSortGroups={() => onGroups(sortGroups(groups))}
          onUngroup={() => {
            onGroups(groups.filter((g) => g.id !== open.id));
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

/** A group's header, as a Chrome tab group's label: the colour, the name, the count. A click
 *  folds or opens it; right-click (or ⋯) opens its menu. Drop a project here to move it in. */
function GroupHeader({
  group,
  count,
  folded,
  autoMenu,
  onToggle,
  onMenu,
}: {
  group: ProjectGroup;
  count: number;
  folded: boolean;
  autoMenu: boolean;
  onToggle: () => void;
  onMenu: (at: DOMRect) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `group:${group.id}` });
  const { attributes, listeners, setNodeRef: setDrag, isDragging } = useDraggable({ id: `gdrag:${group.id}`, data: { groupId: group.id } });
  const el = useRef<HTMLDivElement | null>(null);
  // A drag that ends where it began would also be a click: it must not fold the group.
  const dragged = useRef(false);
  if (isDragging) dragged.current = true;
  // A group just made opens its menu, to be named.
  useLayoutEffect(() => {
    if (autoMenu && el.current) onMenu(el.current.getBoundingClientRect());
    // Once, when it is new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMenu]);
  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        setDrag(n);
        el.current = n;
      }}
      {...attributes}
      {...listeners}
      data-group-header
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onToggle();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.currentTarget.getBoundingClientRect());
      }}
      title={folded ? "Open the group · drag to move it" : "Fold the group · drag to move it"}
      className={[
        "group/g flex h-[26px] cursor-default select-none items-center gap-1.5 rounded-md px-1.5 transition-colors",
        isOver ? "bg-white/10 ring-1 ring-inset ring-white/60" : "hover:bg-[#1b1c20]",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      <Icon name="chevron" className={["h-3 w-3 shrink-0 text-muted transition-transform", folded ? "" : "rotate-90"].join(" ")} />
      <span
        className={["flex h-[18px] min-w-[18px] items-center rounded-full text-[12px] font-semibold text-black", group.name ? "px-2" : "w-[18px] px-0"].join(" ")}
        style={{ background: group.color }}
      >
        <span className="truncate">{group.name}</span>
      </span>
      <span className="font-mono text-[11px] text-muted">{count}</span>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onMenu((e.currentTarget.parentElement as HTMLElement).getBoundingClientRect());
        }}
        title="Name, colour, sort, ungroup"
        className="ml-auto rounded p-0.5 text-faint opacity-0 hover:bg-white/10 hover:text-fg group-hover/g:opacity-100"
      >
        <Icon name="more" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Drop a project here to take it out of its group. Shown only when there are projects in
 *  no group, or while a project is dragged (it is the place to drop one out of its group). */
function UngroupedHeader({ hasProjects }: { hasProjects: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: "group:none" });
  const { active } = useDndContext();
  if (!hasProjects && !active?.data.current?.path) return null;
  return (
    <div
      ref={setNodeRef}
      className={["mt-1 flex h-[22px] items-center rounded-md px-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted transition-colors", isOver ? "bg-white/10 ring-1 ring-inset ring-white/60 text-fg" : ""].join(" ")}
    >
      Ungrouped
    </div>
  );
}

/** A group's menu, as Chrome's: its name, its colour, sort, ungroup. */
function GroupMenu({
  group,
  at,
  onChange,
  onSort,
  onSortGroups,
  onUngroup,
  onClose,
}: {
  group: ProjectGroup;
  at: DOMRect;
  onChange: (c: Partial<ProjectGroup>) => void;
  onSort: () => void;
  onSortGroups: () => void;
  onUngroup: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest("[data-group-header]")) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const item = "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-text hover:bg-[#04395e]";
  return (
    <div
      ref={box}
      style={{ left: at.left, top: at.bottom + 4 }}
      className="fixed z-50 w-[236px] rounded-lg bg-card p-2 shadow-float ring-1 ring-inset ring-white/[0.2]"
    >
      <input
        autoFocus
        defaultValue={group.name}
        placeholder="Name this group"
        spellCheck={false}
        onChange={(e) => onChange({ name: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && onClose()}
        className="h-[28px] w-full rounded-[4px] border border-[#3c3c3c] bg-[#313131] px-2 text-[13px] text-text placeholder:text-[#989898] focus:border-[#0078d4] focus:outline-none"
      />
      <div className="my-2 flex flex-wrap gap-1.5 px-0.5">
        {GROUP_COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => onChange({ color: c.value })}
            title={c.name}
            className="h-5 w-5 rounded-full transition-transform hover:scale-110"
            style={{ background: c.value, boxShadow: c.value === group.color ? `0 0 0 2px #101113, 0 0 0 3.5px ${c.value}` : undefined }}
          />
        ))}
      </div>
      <div className="my-1 h-px bg-[#2b2b2b]" />
      <button onClick={onSort} className={item}>
        <Icon name="sort" className="h-3.5 w-3.5 text-muted" />
        Sort this group A–Z
      </button>
      <button onClick={onSortGroups} className={item}>
        <Icon name="sort" className="h-3.5 w-3.5 text-muted" />
        Sort all groups A–Z
      </button>
      <button onClick={onUngroup} className={item}>
        <Icon name="close" className="h-3.5 w-3.5 text-muted" />
        Ungroup
      </button>
    </div>
  );
}

/** A section action: an icon only, its name in the tooltip, as in VS Code. */
function HeadButton({
  icon,
  title,
  onClick,
  on,
}: {
  icon: "clone" | "folderPlus" | "github" | "select" | "settings";
  title: string;
  onClick: () => void;
  on?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={on}
      className={[
        "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] text-text hover:bg-[#2a2d2e]",
        on ? "bg-white/[0.12] ring-1 ring-inset ring-white/30" : "",
      ].join(" ")}
    >
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

/** A project to drag onto tabs or groups. In a group, it is also a drop target: another
 *  project dropped on it lands next to it (before or after, by which half it is let go on). */
function DraggableProject({
  project,
  home,
  groupId,
  picked,
  onToggle,
}: {
  project: Project;
  home: string | null;
  groupId?: string;
  picked: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDrag, isDragging } = useDraggable({
    id: `project:${project.path}`,
    data: { path: project.path },
  });
  const { isOver, setNodeRef: setDrop } = useDroppable({ id: `gitem:${groupId ?? ""}:${project.path}`, disabled: !groupId });
  // A drag that ends where it began would also be a click: it must not pick the project.
  const dragged = useRef(false);
  if (isDragging) dragged.current = true;
  return (
    <div
      ref={(n) => {
        setDrag(n);
        setDrop(n);
      }}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onToggle();
      }}
      className={[isDragging ? "opacity-40" : "", isOver ? "rounded-md ring-1 ring-white/60" : ""].join(" ")}
    >
      <ProjectCard project={project} home={home} highlighted={picked} />
    </div>
  );
}

/** In selection: a click ticks the project; no drag. */
function SelectableProject({ project, home, picked, onToggle }: { project: Project; home: string | null; picked: boolean; onToggle: () => void }) {
  return (
    <div onClick={onToggle} role="checkbox" aria-checked={picked} className="cursor-default">
      <ProjectCard project={project} home={home} picked={picked} />
    </div>
  );
}

/** A project's block: its name. The path is in the tooltip; hovering opens nothing. */
export function ProjectCard({
  project,
  home,
  overlay,
  picked,
  highlighted,
}: {
  project: Project;
  home: string | null;
  overlay?: boolean;
  /** In Select: picked or not, with a checkbox. */
  picked?: boolean;
  /** Picked by a click, outside Select: no checkbox, the same blue edge. */
  highlighted?: boolean;
}) {
  const selectable = picked !== undefined;
  return (
    <div
      title={tildify(project.path, home)}
      className={[
        // Each project is a block of its own, like a button: a border that lights up on hover,
        // a little press while it is held.
        "flex select-none items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors duration-150",
        selectable ? "" : "cursor-grab active:cursor-grabbing",
        overlay
          ? "w-60 border-white/50 bg-card shadow-float"
          : picked || highlighted
            ? "border-white/45 bg-white/[0.07] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_0_14px_rgba(255,255,255,0.06)]"
            : "border-[#2b2b2b] bg-[#141518] hover:border-[#454850] hover:bg-[#1b1c20] active:scale-[0.985]",
      ].join(" ")}
    >
      {selectable && <input type="checkbox" checked={picked} readOnly tabIndex={-1} className="pointer-events-none shrink-0 accent-white" />}
      <span className="truncate text-[13px] leading-[18px] text-text">{project.name}</span>
    </div>
  );
}
