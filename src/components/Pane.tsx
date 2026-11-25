import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { GitStatus, Project } from "../types";
import { Changes } from "../lib/changes";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { Icon } from "./Icons";
import { ZoomBadge } from "./ZoomBadge";
import { BranchChip } from "./BranchMenu";
import { useGitStatus } from "../lib/gitStatus";
import type { Jump } from "./SearchPanel";
import { blockDoubleClick, useZoomMotion } from "../lib/zoomPane";

/** Git state as a status dot: amber = uncommitted changes, grey = unpushed commits, green = clean. */
function dotColor(g: GitStatus | null): string {
  if (!g?.repo) return "bg-faint";
  if (g.dirty > 0) return "bg-status-progress";
  if (g.ahead > 0) return "bg-status-todo";
  return "bg-status-done";
}

/** One project in a tab: its header, its file tree and one editor. */
export function Pane({
  project,
  onRemove,
  zoomed,
  hidden,
  live,
  file: openFile,
  onFile,
  onZoom,
}: {
  project: Project;
  onRemove: () => void;
  zoomed: boolean;
  hidden: boolean;
  /** The pane's tab is open. */
  live: boolean;
  /** The file open when the pane appears (the one saved in the tab), and each change of it. */
  file: string | null;
  onFile: (path: string | null) => void;
  onZoom: () => void;
}) {
  const [file, setFile] = useState<string | null>(openFile);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;
  useEffect(() => {
    if (file !== openFile) onFileRef.current(file);
    // Only a new file is saved; the saved one coming back is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  // ⌘⇧F in this pane opens the search; a result opens its file at the line.
  const [searchKey, setSearchKey] = useState(0);
  const [jump, setJump] = useState<(Jump & { n: number }) | null>(null);
  const openHit = (j: Jump) => {
    setFile(j.path);
    setJump((old) => ({ ...j, n: (old?.n ?? 0) + 1 }));
  };
  const [dirty, setDirty] = useState(false);
  const [tree, setTree] = useState(true);
  const lines = useRef<[number, number] | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);

  // The file on GitHub, at the cursor's line or the selected lines. ⌥-click copies the link.
  const github = async (copy: boolean, at?: [number, number]) => {
    if (!file) return;
    const [from, to] = at ?? lines.current ?? [undefined, undefined];
    try {
      const url = await api.githubUrl(file, from, to);
      if (copy) {
        await navigator.clipboard.writeText(url);
        setLinkNote("Link copied");
      } else {
        await api.openUrl(url);
      }
    } catch (e) {
      setLinkNote(String(e));
    }
    setTimeout(() => setLinkNote(null), 2500);
  };
  // Read only while the tab is open: a hidden tab's panes wait until it opens.
  const git = useGitStatus(project.path, live);
  const block = useZoomMotion<HTMLElement>(zoomed, hidden);
  const changes = useMemo(() => new Changes(git), [git]);
  const rel = file?.slice(project.path.length + 1);

  const toggleClass = (on: boolean) => ["rounded-md p-1 hover:bg-hover hover:text-fg", on ? "text-fg" : "text-faint"].join(" ");

  return (
    <section
      ref={block}
      tabIndex={-1}
      onDoubleClick={blockDoubleClick(onZoom)}
      onKeyDownCapture={(e) => {
        if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "KeyF") {
          e.preventDefault();
          e.stopPropagation();
          setTree(true);
          setSearchKey((k) => k + 1);
        }
      }}
      className={["flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md tab-edge bg-panel", hidden ? "hidden" : ""].join(" ")}
    >
      <header className="flex h-10 shrink-0 items-center gap-2.5 border-b border-[#2b2b2b] px-3">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor(git)}`} title={git?.repo ? `${git.dirty} changed` : "not a git repo"} />
        <span className="shrink-0 text-[13px] font-bold text-text">{project.name}</span>
        {git?.repo && <BranchChip path={project.path} git={git} />}
        {rel && (
          <span className="min-w-0 truncate text-[13px] text-muted" title={file ?? ""}>
            {rel}
            {dirty && <span className="text-fg"> ●</span>}
          </span>
        )}
        {rel && (
          <button onClick={() => setFile(null)} title="Close the file (saves it first)" className="-ml-1.5 shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-fg">
            <Icon name="close" className="h-3 w-3" />
          </button>
        )}
        {zoomed && <ZoomBadge />}
        {linkNote && <span className="shrink-0 truncate text-[12px] text-[#e2c08d]">{linkNote}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {file && git?.repo && (
            <button
              onClick={(e) => github(e.altKey)}
              title="Open on GitHub, at this line or the selected lines  ·  ⌥-click copies the link"
              className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg"
            >
              <Icon name="github" className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => setTree((v) => !v)} title="Show or hide the file tree" className={toggleClass(tree)}>
            <Icon name="tree" className="h-3.5 w-3.5" />
          </button>
          <button onClick={onRemove} title="Remove from this tab (Claude loses access too)" className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        {tree && (
          <div className="w-56 shrink-0 overflow-auto border-r border-[#2b2b2b]">
            <FileTree root={project.path} current={file} changes={changes} onOpen={setFile} searchKey={searchKey} onFound={openHit} live={live} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Editor
            path={file}
            jump={jump}
            diff
            head={git?.head ?? ""}
            onDirty={setDirty}
            onLines={(a, b) => (lines.current = [a, b])}
            fontId={project.path}
            onGithub={git?.repo ? (copy, from, to) => github(copy, [from, to]) : undefined}
          />
        </div>
      </div>
    </section>
  );
}
