import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DirEntry } from "../types";
import { CODE_COLOR, type Changes } from "../lib/changes";
import { dirOf, onFsChange } from "../lib/fsEvents";
import { Icon } from "./Icons";
import { SearchPanel, type Jump } from "./SearchPanel";

/** How long a file that just changed on disk stays highlighted. */
const RECENT_MS = 4000;

interface Props {
  root: string;
  current: string | null;
  changes: Changes;
  onOpen: (path: string) => void;
  /** Changes on ⌘⇧F: the Search mode opens and its box gets the focus. */
  searchKey: number;
  onFound: (j: Jump) => void;
  /** Its tab is open. A hidden tab's tree reloads nothing: it notes a change, and reloads
   *  its open folders once when the tab opens. */
  live: boolean;
}

/** A project's files, or only its changed ones. Folders load when they open, and load again
 *  when something in them changes on disk. Git state colours each name, as in VS Code. */
export function FileTree({ root, current, changes, onOpen, searchKey, onFound, live }: Props) {
  const [mode, setMode] = useState<"all" | "changed" | "search">("all");
  useEffect(() => {
    if (searchKey > 0) setMode("search");
  }, [searchKey]);
  const [open, setOpen] = useState<Set<string>>(() => new Set([root]));
  const [entries, setEntries] = useState<Record<string, DirEntry[]>>({});
  const [recent, setRecent] = useState<Set<string>>(() => new Set());
  const openRef = useRef(open);
  openRef.current = open;
  const liveRef = useRef(live);
  liveRef.current = live;
  const missed = useRef(false);

  const load = useCallback(async (dir: string) => {
    try {
      const list = await api.readDir(dir);
      setEntries((e) => ({ ...e, [dir]: list }));
    } catch {
      setEntries((e) => ({ ...e, [dir]: [] }));
    }
  }, []);

  useEffect(() => {
    load(root);
    const refresh = () => (liveRef.current ? openRef.current.forEach((d) => load(d)) : (missed.current = true));
    window.addEventListener("focus", refresh);
    const off = onFsChange((paths) => {
      const mine = paths.filter((p) => (p === root || p.startsWith(root + "/")) && !p.includes("/.git/") && !p.endsWith("/.git"));
      if (mine.length === 0) return;
      if (!liveRef.current) {
        missed.current = true;
        return;
      }
      // Reload each open folder that holds a changed path (all of them on a rescan of the root).
      const dirs = new Set(mine.map(dirOf));
      openRef.current.forEach((d) => (mine.includes(d) || dirs.has(d)) && load(d));
      const files = mine.filter((p) => p !== root);
      setRecent((r) => new Set([...r, ...files]));
      setTimeout(() => setRecent((r) => new Set([...r].filter((p) => !files.includes(p)))), RECENT_MS);
    });
    return () => {
      window.removeEventListener("focus", refresh);
      off();
    };
  }, [root, load]);
  useEffect(() => {
    if (live && missed.current) {
      missed.current = false;
      openRef.current.forEach((d) => load(d));
    }
  }, [live, load]);

  const toggle = (dir: string) => {
    const next = new Set(open);
    if (next.has(dir)) {
      next.delete(dir);
    } else {
      next.add(dir);
      if (!entries[dir]) load(dir);
    }
    setOpen(next);
  };

  const row = (e: DirEntry, depth: number, label?: React.ReactNode) => {
    const code = e.dir ? undefined : changes.code(e.path);
    const dot = e.dir && changes.inDir(e.path);
    const isOpen = e.dir && open.has(e.path);
    const gone = code === "D";
    return (
      <button
        key={e.path}
        onClick={() => (e.dir ? toggle(e.path) : !gone && onOpen(e.path))}
        style={{ paddingLeft: depth * 12 + 8 }}
        title={code ? `${e.path} · ${CODE_NAME[code] ?? code}` : e.path}
        className={[
          "flex h-[22px] w-full items-center gap-1.5 pr-2 text-left text-[13px] transition-colors duration-700",
          e.path === current ? "bg-[#04395e] ring-1 ring-inset ring-[#0078d4]" : "hover:bg-[#2a2d2e]",
          recent.has(e.path) ? "bg-[#e2c08d]/[0.12] duration-0" : "",
          code ? CODE_COLOR[code] : e.path === current ? "text-white" : "text-text",
        ].join(" ")}
      >
        {e.dir ? (
          <Icon name="chevron" className={["h-3.5 w-3.5 text-[#cccccc] transition-transform", isOpen ? "rotate-90" : ""].join(" ")} />
        ) : (
          <span className="w-3" />
        )}
        <span className={["truncate", gone ? "line-through opacity-70" : ""].join(" ")}>{label ?? e.name}</span>
        {code && <span className="ml-auto pl-2 font-mono text-[10.5px]">{code}</span>}
        {dot && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#e2c08d]/80" />}
      </button>
    );
  };

  const rows = (dir: string, depth: number): React.ReactNode =>
    (entries[dir] ?? []).map((e) => (
      <div key={e.path}>
        {row(e, depth)}
        {e.dir && open.has(e.path) && rows(e.path, depth + 1)}
      </div>
    ));

  // Changed files as a flat list: the name, then its folder in the project.
  const changed = changes.list().filter(([p]) => p.startsWith(root + "/"));
  const changedRows = changed.map(([path]) => {
    const isDir = path.endsWith("/");
    const clean = path.replace(/\/$/, "");
    const rel = dirOf(clean.slice(root.length + 1));
    const name = clean.slice(clean.lastIndexOf("/") + 1) + (isDir ? "/" : "");
    return row({ path: clean, name, dir: false }, 0, (
      <>
        {name}
        {rel && <span className="ml-1.5 text-[12px] text-muted">{rel}</span>}
      </>
    ));
  });

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex gap-1 border-b border-[#2b2b2b] bg-panel px-2 py-1.5">
        {(["all", "changed", "search"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={[
              "rounded-full px-2.5 py-0.5 text-[12px] transition-colors",
              mode === m ? "bg-white/[0.12] text-fg" : "text-muted hover:text-fg",
            ].join(" ")}
          >
            {m === "all" ? "Files" : m === "changed" ? "Changed" : "Search"}
            {m === "changed" && changed.length > 0 && <span className="ml-1.5 font-mono text-[10.5px] text-[#e2c08d]">{changed.length}</span>}
          </button>
        ))}
      </div>
      {mode === "search" ? (
        <SearchPanel root={root} focusKey={searchKey} onPick={onFound} />
      ) : (
        <div className="py-1">
          {mode === "all" ? rows(root, 0) : changedRows.length > 0 ? changedRows : (
            <div className="px-3 py-6 text-center text-[12px] text-muted">No changes against HEAD</div>
          )}
        </div>
      )}
    </div>
  );
}

const CODE_NAME: Record<string, string> = { M: "modified", A: "added", U: "untracked", R: "renamed", D: "deleted" };
