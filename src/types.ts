export interface Project {
  name: string;
  path: string;
}

/** A terminal tab's panes, as iTerm splits them: a shell, or a row (side by side) or a
 *  column (stacked) of parts. `sizes` are the parts' shares, summing to 1. */
export type Split =
  | { kind: "term"; id: string }
  | { kind: "split"; dir: "row" | "col"; parts: Split[]; sizes: number[] };

export interface Tab {
  id: string;
  /** "terminal": only split shells, no projects. Unset: a project tab. */
  kind?: "terminal";
  /** The terminal tab's panes. */
  term?: Split;
  /** Set when the user renames the tab; otherwise the project names. */
  name?: string;
  /** Project paths, in pane order. */
  projects: string[];
  /** The project panes' shares of the width, in pane order (they sum to 1). */
  widths?: number[];
  /** The code area's share of the height, this tab's own; the terminal has the rest. */
  split?: number;
  /** The file open in each project's pane, by project path: it opens again after a restart. */
  files?: Record<string, string | null>;
}

export interface Layout {
  tabs: Tab[];
  active: string | null;
  /** The code area's share of the height in a tab that has no split of its own (one saved
   *  before splits were per tab). It does not change: a drag sets the tab's own split. */
  split: number;
  /** Session restore: each shell's folder and foreground command, by PTY id. */
  shells?: Record<string, { cwd?: string | null; command?: string | null }>;
  /** The names the user gave terminals, by PTY id. */
  names?: Record<string, string>;
  /** Project groups in the sidebar, in order. */
  groups?: ProjectGroup[];
}

/** A group of projects in the sidebar, as Chrome groups tabs. */
export interface ProjectGroup {
  id: string;
  /** May be empty: an unnamed group shows its colour only. */
  name: string;
  /** `#rrggbb`, from lib/groups GROUP_COLORS. */
  color: string;
  collapsed?: boolean;
  /** Project paths, in the order they joined. */
  paths: string[];
}

export interface DirEntry {
  name: string;
  path: string;
  dir: boolean;
}

export interface GitStatus {
  repo: boolean;
  branch: string;
  /** The HEAD commit; "" before the first commit. */
  head: string;
  dirty: number;
  ahead: number;
  behind: number;
  /** [absolute path, M | A | D | U | R]. An untracked folder's path ends in "/". */
  files: [string, string][];
}

export interface Branch {
  name: string;
  /** The branch it tracks (origin/main), or "". */
  upstream: string;
  /** When its last commit was made: "2 days ago". */
  when: string;
}

export interface Branches {
  current: string;
  local: Branch[];
  /** Remote branches with no local branch of the same name. */
  remote: Branch[];
}

/** One matching line of a project search (src-tauri/src/search.rs). */
export interface Hit {
  path: string;
  /** 1-based. */
  line: number;
  /** The line, or the part of a long line around the match. */
  text: string;
  /** Where `text` starts in the line, and the matches in `text`: UTF-16 offsets. */
  offset: number;
  ranges: [number, number][];
}

export interface Found {
  hits: Hit[];
  files: number;
  /** The cap was reached: there are more matches. */
  truncated: boolean;
}

export type PtyEvent = { kind: "data"; data: string } | { kind: "exit" };
