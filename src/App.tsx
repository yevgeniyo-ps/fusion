import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { homeDir } from "@tauri-apps/api/path";
import { TabPalette, noteOpen } from "./components/TabPalette";
import { states as ptyStatesShared } from "./lib/usage";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import type { Layout, Project, ProjectGroup, Tab } from "./types";
import { baseName, tabName } from "./lib/names";
import { ProjectCard, Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { Workspace } from "./components/Workspace";
import { CloneDialog } from "./components/CloneDialog";
import { ImportDialog } from "./components/ImportDialog";
import { TermTab } from "./components/TermTab";
import { SessionNames } from "./components/SessionName";
import { leaf, leaves } from "./lib/splits";
import { setSaved } from "./lib/restore";
import { insertNear, moveGroup, moveTo } from "./lib/groups";
import { projectTermId } from "./lib/projectTerm";
import { Icon } from "./components/Icons";

const EMPTY: Layout = { tabs: [], active: null, split: 0.6 };
const SIDEBAR_KEY = "fusion.sidebar";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Project | null>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sidebar, setSidebar] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    homeDir().then((h) => setHome(h.replace(/\/+$/, "")), () => {});
    (async () => {
      const [list, saved] = await Promise.all([api.projectsLoad(), api.layoutLoad()]);
      const layout = saved?.tabs ? { ...EMPTY, ...saved } : EMPTY;
      // A tab can name a folder that is not in the list (it came from an older list):
      // add it, so the tab keeps working. A folder that is gone stays a "missing" pane.
      const known = new Set(list.map((p) => p.path));
      const renamed = new Map<string, string>();
      for (const path of new Set(layout.tabs.flatMap((t) => t.projects))) {
        if (known.has(path)) continue;
        try {
          const p = await api.projectAdd(path);
          if (!known.has(p.path)) list.push(p);
          known.add(p.path);
          renamed.set(path, p.path);
        } catch {
          /* the folder is gone */
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setSaved(layout.shells ?? {});
      setProjects(list);
      setLayout({ ...layout, tabs: layout.tabs.map((t) => ({ ...t, projects: t.projects.map((p) => renamed.get(p) ?? p) })) });
    })().catch(console.error);
  }, []);

  // Saved a moment after the last change.
  useEffect(() => {
    if (!layout) return;
    const timer = setTimeout(() => api.layoutSave(layout).catch(console.error), 300);
    return () => clearTimeout(timer);
  }, [layout]);

  // Session restore: every 3 s, what each shell runs. Only shells of open tabs are kept; a
  // shell not running yet (its tab folder not ready) keeps what was saved for it.
  const loaded = layout !== null;
  useEffect(() => {
    if (!loaded) return;
    const timer = setInterval(async () => {
      const live = await ptyStatesShared();
      setLayout((l) => {
        if (!l) return l;
        const ids = new Set(l.tabs.flatMap((t) => (t.term ? leaves(t.term) : [t.id, ...t.projects.map((p) => projectTermId(t.id, p))])));
        const shells: NonNullable<Layout["shells"]> = {};
        for (const id of ids) {
          const s = live[id] ?? l.shells?.[id];
          if (s) shells[id] = s;
        }
        const names = Object.fromEntries(Object.entries(l.names ?? {}).filter(([id]) => ids.has(id)));
        const same = JSON.stringify(shells) === JSON.stringify(l.shells ?? {}) && JSON.stringify(names) === JSON.stringify(l.names ?? {});
        return same ? l : { ...l, shells, names };
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [loaded]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebar ? "1" : "0");
    } catch {
      /* private storage: just not remembered */
    }
  }, [sidebar]);

  const byPath = useMemo(() => new Map(projects.map((p) => [p.path, p])), [projects]);
  const update = (fn: (l: Layout) => Layout) => setLayout((l) => l && fn(l));
  const pickTab = (id: string) => update((l) => ({ ...l, active: id }));
  const [palette, setPalette] = useState(false);
  const activeId = layout?.active ?? null;
  useEffect(() => noteOpen(activeId), [activeId]);

  const newTab = (paths: string[] = []) =>
    update((l) => {
      const id = crypto.randomUUID();
      const here = l.tabs.find((t) => t.id === l.active);
      return { ...l, active: id, tabs: [...l.tabs, { id, projects: paths, split: here?.split ?? l.split }] };
    });
  /** A tab of plain shells, split as iTerm splits them. */
  const newTermTab = () =>
    update((l) => {
      const id = crypto.randomUUID();
      return { ...l, active: id, tabs: [...l.tabs, { id, kind: "terminal", term: leaf(), projects: [] }] };
    });
  // A terminal tab takes no projects: a project dropped on it is ignored.
  const addToTab = (id: string, path: string) =>
    update((l) => {
      const tab = l.tabs.find((t) => t.id === id);
      if (!tab || tab.kind === "terminal") return l;
      return {
        ...l,
        active: id,
        tabs: l.tabs.map((t) => (t.id === id && !t.projects.includes(path) ? { ...t, projects: [...t.projects, path] } : t)),
      };
    });
  const setTerm = (id: string, term: Tab["term"]) => update((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === id ? { ...t, term } : t)) }));
  const removeFromTab = (id: string, path: string) => {
    api.ptyKill(projectTermId(id, path)).catch(() => {});
    update((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === id ? { ...t, projects: t.projects.filter((p) => p !== path) } : t)) }));
  };
  const closeTab = (id: string) => {
    const tab = layout?.tabs.find((t) => t.id === id);
    if (tab?.term) leaves(tab.term).forEach((p) => api.ptyKill(p).catch(() => {}));
    tab?.projects.forEach((p) => api.ptyKill(projectTermId(tab.id, p)).catch(() => {}));
    api.tabClose(id).catch(console.error);
    update((l) => {
      const i = l.tabs.findIndex((t) => t.id === id);
      const tabs = l.tabs.filter((t) => t.id !== id);
      const active = l.active === id ? (tabs[Math.max(0, i - 1)]?.id ?? null) : l.active;
      return { ...l, tabs, active };
    });
  };
  const renameTab = (id: string, name: string) =>
    update((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === id ? { ...t, name: name || undefined } : t)) }));

  const addProject = (p: Project, toTab: boolean) => {
    setProjects((list) => (list.some((q) => q.path === p.path) ? list : [...list, p].sort((a, b) => a.name.localeCompare(b.name))));
    if (toTab && layout?.active) addToTab(layout.active, p.path);
  };
  // Out of Fusion, out of every tab that has them (their panes and project terminals go);
  // the folders stay on disk.
  const removeProjects = (ps: Project[]) => {
    const gone = new Set(ps.map((p) => p.path));
    for (const p of ps) api.projectRemove(p.path).catch(console.error);
    setProjects((list) => list.filter((q) => !gone.has(q.path)));
    for (const t of layout?.tabs ?? []) for (const p of t.projects) if (gone.has(p)) removeFromTab(t.id, p);
    update((l) => ({ ...l, groups: (l.groups ?? []).map((g) => ({ ...g, paths: g.paths.filter((p) => !gone.has(p)) })) }));
  };
  const addFolder = async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") addProject(await api.projectAdd(dir), false);
  };

  const addFolderRef = useRef(addFolder);
  addFolderRef.current = addFolder;
  // ⌘⇧C: clone a repo. ⌘O: add a folder. ⌘T: new tab (⌘⇧T: terminal tab). ⌘1…⌘8: go to a
  // tab, ⌘9: the last one. ⌘⇧A: the tab list (TabBar). ⌘K or ⌘⌥P: go to a tab (TabPalette). [: show or hide the projects.
  // (⌘+ / ⌘- / ⌘0 change the font of the focused terminal or editor: lib/fontSize.)
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName) || !!target.closest(".cm-editor, .xterm"));
      if (e.metaKey && e.shiftKey && e.code === "KeyC") {
        e.preventDefault();
        setCloning(true);
      } else if (e.metaKey && !e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        addFolderRef.current();
      } else if (e.metaKey && !e.shiftKey && !e.ctrlKey && (e.code === "KeyK" ? !e.altKey : e.altKey && e.code === "KeyP")) {
        e.preventDefault();
        e.stopPropagation();
        setPalette((p) => !p);
      } else if (e.metaKey && e.code === "KeyT") {
        e.preventDefault();
        if (e.shiftKey) newTermTab();
        else newTab();
      } else if (e.metaKey && /^[1-9]$/.test(e.key)) {
        const tabs = layoutRef.current?.tabs ?? [];
        const t = e.key === "9" ? tabs[tabs.length - 1] : tabs[Number(e.key) - 1];
        if (t) {
          e.preventDefault();
          pickTab(t.id);
        }
      } else if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        setSidebar((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    setDragging(byPath.get(e.active.data.current?.path) ?? null);
    setDraggingTab(e.active.data.current?.tabId ?? null);
    setDraggingGroup(e.active.data.current?.groupId ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    setDraggingTab(null);
    setDraggingGroup(null);
    const over = String(e.over?.id ?? "");
    // A tab dropped on another: it goes before it, or after it when let go on its right half.
    const tabId: string | undefined = e.active.data.current?.tabId;
    if (tabId) {
      const target = over.startsWith("tab:") ? over.slice(4) : null;
      const moved = e.active.rect.current.translated;
      if (!target || target === tabId || !moved || !e.over) return;
      const after = moved.left + moved.width / 2 > e.over.rect.left + e.over.rect.width / 2;
      update((l) => {
        const tab = l.tabs.find((t) => t.id === tabId)!;
        const rest = l.tabs.filter((t) => t.id !== tabId);
        const at = rest.findIndex((t) => t.id === target) + (after ? 1 : 0);
        return { ...l, tabs: [...rest.slice(0, at), tab, ...rest.slice(at)] };
      });
      return;
    }
    // A group's header dropped on another's: the group goes before it, or after it when let
    // go on its lower half.
    const groupId: string | undefined = e.active.data.current?.groupId;
    if (groupId) {
      const target = over.startsWith("group:") && over !== "group:none" ? over.slice(6) : null;
      const moved = e.active.rect.current.translated;
      if (!target || !moved || !e.over) return;
      const after = moved.top + moved.height / 2 > e.over.rect.top + e.over.rect.height / 2;
      return update((l) => ({ ...l, groups: moveGroup(l.groups ?? [], groupId, target, after) }));
    }
    const path: string | undefined = e.active.data.current?.path;
    if (!path || !over) return;
    // Groups in the sidebar: onto a header moves the project in, onto Ungrouped takes it out,
    // onto a member places it before or after that member.
    if (over === "group:none") return update((l) => ({ ...l, groups: moveTo(l.groups ?? [], [path], null) }));
    if (over.startsWith("group:")) return update((l) => ({ ...l, groups: moveTo(l.groups ?? [], [path], over.slice(6)) }));
    if (over.startsWith("gitem:")) {
      const [groupId, ...rest] = over.slice(6).split(":");
      const target = rest.join(":");
      const moved = e.active.rect.current.translated;
      const after = !!moved && !!e.over && moved.top + moved.height / 2 > e.over.rect.top + e.over.rect.height / 2;
      return update((l) => ({ ...l, groups: insertNear(l.groups ?? [], path, groupId, target, after) }));
    }
    if (over.startsWith("newtab")) newTab([path]);
    else if (over.startsWith("tab:")) addToTab(over.slice(4), path);
    else if (over.startsWith("ws:")) addToTab(over.slice(3), path);
  };

  const renameSession = (id: string, name: string) =>
    update((l) => {
      const names = { ...(l.names ?? {}) };
      if (name) names[id] = name;
      else delete names[id];
      return { ...l, names };
    });

  if (!layout) return <div className="h-full" data-tauri-drag-region />;

  const fallback = (path: string): Project => ({ name: baseName(path), path });

  return (
    <SessionNames.Provider value={{ names: layout.names ?? {}, rename: renameSession }}>
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex h-full">
        {sidebar && (
          <Sidebar
            projects={projects}
            home={home}
            onFold={() => setSidebar(false)}
            onClone={() => setCloning(true)}
            onAddFolder={addFolder}
            onImport={() => setImporting(true)}
            onRemove={removeProjects}
            onOpen={(paths) => newTab(paths)}
            groups={layout.groups ?? []}
            onGroups={(groups) => update((l) => ({ ...l, groups }))}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TabBar
            tabs={layout.tabs}
            active={layout.active}
            byPath={byPath}
            sidebarOpen={sidebar}
            onUnfold={() => setSidebar(true)}
            onPick={pickTab}
            onClose={closeTab}
            onNew={() => newTab()}
            onNewTerm={newTermTab}
            onRename={renameTab}
          />
          <div className="relative min-h-0 flex-1">
            {layout.tabs.map((t) =>
              t.kind === "terminal" && t.term ? (
                <TermTab
                  key={t.id}
                  tab={t}
                  active={t.id === layout.active}
                  onChange={(term) => setTerm(t.id, term)}
                  onEmpty={() => closeTab(t.id)}
                />
              ) : (
              <Workspace
                key={t.id}
                tab={t}
                name={tabName(t, byPath)}
                projects={t.projects.map((p) => byPath.get(p) ?? fallback(p))}
                active={t.id === layout.active}
                split={t.split ?? layout.split}
                onSplit={(split) => update((l) => ({ ...l, tabs: l.tabs.map((x) => (x.id === t.id ? { ...x, split } : x)) }))}
                onRemove={(path) => removeFromTab(t.id, path)}
                onWidths={(widths) => update((l) => ({ ...l, tabs: l.tabs.map((x) => (x.id === t.id ? { ...x, widths } : x)) }))}
                onFile={(path, file) => update((l) => ({ ...l, tabs: l.tabs.map((x) => (x.id === t.id ? { ...x, files: { ...x.files, [path]: file } } : x)) }))}
              />
              ),
            )}
            {layout.tabs.length === 0 && <Start />}

          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && <ProjectCard project={dragging} home={home} overlay />}
        {draggingTab && <TabGhost name={tabName(layout.tabs.find((t) => t.id === draggingTab) ?? { id: "", projects: [] }, byPath)} />}
        {draggingGroup && <GroupGhost group={(layout.groups ?? []).find((g) => g.id === draggingGroup)} />}
      </DragOverlay>
      {palette && (
        <TabPalette
          tabs={layout.tabs}
          active={layout.active}
          byPath={byPath}
          projects={projects}
          onPick={pickTab}
          onOpen={(path) => newTab([path])}
          onClose={() => setPalette(false)}
        />
      )}
      {importing && <ImportDialog open onClose={() => setImporting(false)} onProject={(p) => addProject(p, false)} />}
      <CloneDialog open={cloning} canAddToTab={!!layout.active} onClose={() => setCloning(false)} onDone={addProject} />
    </DndContext>
    </SessionNames.Provider>
  );
}

/** No tabs yet: the whole area takes a dropped project and makes the first tab. */
function Start() {
  const { isOver, setNodeRef } = useDroppable({ id: "newtab:start" });
  return (
    <div className="absolute inset-0 px-3 pb-3">
      <div
        ref={setNodeRef}
        className={[
          "flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center transition",
          isOver ? "border-accent/70 bg-accent/5" : "border-white/[0.26]",
        ].join(" ")}
      >
        <Icon name="spark" className="h-6 w-6 text-muted" />
        <span className="font-mono text-sm text-muted">drag projects here to make a mix</span>
        <span className="max-w-sm text-[12px] leading-relaxed text-faint">
          Each tab mixes some projects: a pane for each, one terminal under them. Claude in that terminal sees only the projects in the tab.
        </span>
      </div>
    </div>
  );
}

/** The tab under the pointer while it moves. */
function TabGhost({ name }: { name: string }) {
  return (
    <div className="flex h-7 w-max items-center rounded-full bg-panel px-3.5 text-[13px] font-medium text-white shadow-float ring-1 ring-inset ring-white/50">
      {name}
    </div>
  );
}

/** The group header under the pointer while it moves. */
function GroupGhost({ group }: { group?: ProjectGroup }) {
  if (!group) return null;
  return (
    <div className="flex h-[26px] w-max items-center gap-1.5 rounded-md bg-card px-2 shadow-float ring-1 ring-inset ring-white/50">
      <span className="flex h-[18px] min-w-[18px] items-center rounded-full px-2 text-[12px] font-semibold text-black" style={{ background: group.color }}>
        {group.name}
      </span>
      <span className="font-mono text-[11px] text-muted">{group.paths.length}</span>
    </div>
  );
}
