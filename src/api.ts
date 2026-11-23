import { Channel, invoke } from "@tauri-apps/api/core";
import type { Usage } from "./lib/usage";
import type { Found, Branches, DirEntry, GitStatus, Layout, Project, PtyEvent } from "./types";

/** A repo of a GitHub org or user (src-tauri/src/github.rs). */
export interface GhRepo {
  name: string;
  full_name: string;
  description: string;
  visibility: string;
  archived: boolean;
  pushed_at: string;
  /** The folder already has a checkout of this name. */
  exists: boolean;
  /** It is a Fusion project already. */
  project: boolean;
}

export type ImportEvent =
  | { kind: "progress"; name: string; line: string }
  | { kind: "done"; name: string; cloned: boolean; project: Project }
  | { kind: "failed"; name: string; error: string };

// One function per Rust command (src-tauri/src). Tauri maps camelCase args to snake_case.
export const api = {
  projectsLoad: () => invoke<Project[]>("projects_load"),
  projectAdd: (path: string) => invoke<Project>("project_add", { path }),
  /** Removes a project from Fusion; the folder stays on disk. */
  projectRemove: (path: string) => invoke<void>("project_remove", { path }),
  projectClone: (url: string, parent: string, name: string, onProgress: Channel<string>) =>
    invoke<Project>("project_clone", { url, parent, name, onProgress }),
  /** An org's (or user's) repos, newest push first; marks the ones already in `parent`. */
  githubRepos: (input: string, parent: string) => invoke<{ owner: string; repos: GhRepo[] }>("github_repos", { input, parent }),
  /** Checks out each repo ("org/name") into `parent` and adds it as a project; events per repo. */
  githubImport: (parent: string, repos: string[], onEvent: Channel<ImportEvent>) => invoke<void>("github_import", { parent, repos, onEvent }),
  layoutLoad: () => invoke<Layout | null>("layout_load"),
  layoutSave: (layout: Layout) => invoke<void>("layout_save", { layout }),

  /** Find in the project's files: matching lines by file, .gitignore honoured. */
  search: (path: string, query: string, caseSensitive: boolean, wholeWord: boolean, regex: boolean) =>
    invoke<Found>("search", { path, query, caseSensitive, wholeWord, regex }),
  readDir: (path: string) => invoke<DirEntry[]>("read_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, text: string) => invoke<void>("write_file", { path, text }),
  gitStatus: (path: string) => invoke<GitStatus>("git_status", { path }),
  /** The file as HEAD has it; null when HEAD does not have it. */
  gitBranches: (path: string) => invoke<Branches>("git_branches", { path }),
  /** Switch branch; `create` makes a new one, `remote` tracks origin/<name>. Git's error on refusal. */
  gitSwitch: (path: string, branch: string, create: boolean, remote: boolean) =>
    invoke<void>("git_switch", { path, branch, create, remote }),
  /** `git pull --ff-only` in the background: a one-line result per project. */
  gitPull: (path: string) => invoke<{ ok: boolean; summary: string }>("git_pull", { path }),
  /** `git push -u origin <current branch>`: publishes a new branch. Git's error on failure. */
  gitPublish: (path: string) => invoke<void>("git_publish", { path }),
  /** A quiet background fetch; false when it failed or timed out (no network, a password). */
  gitFetch: (path: string) => invoke<boolean>("git_fetch", { path }),
  gitHeadFile: (path: string) => invoke<string | null>("git_head_file", { path }),
  /** The file's page on GitHub, at lines from..to (1-based). */
  githubUrl: (path: string, from?: number, to?: number) => invoke<string>("github_url", { path, from, to }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),

  tabSync: (id: string, name: string, projects: { name: string; path: string }[]) =>
    invoke<string>("tab_sync", { id, name, projects }),
  tabClose: (id: string) => invoke<void>("tab_close", { id }),

  /** The Claude tokens of a terminal's session; null before its first reply. */
  claudeUsage: (id: string, plain: boolean, cwd: string | null) => invoke<Usage | null>("claude_usage", { id, plain, cwd }),
  /** `plain`: a shell in the home folder (a terminal tab's pane), not in the tab folder. */
  ptySpawn: (id: string, cols: number, rows: number, plain: boolean, cwd: string | null, run: string | null, onEvent: Channel<PtyEvent>) =>
    invoke<void>("pty_spawn", { id, cols, rows, plain, cwd, run, onEvent }),
  /** What each shell runs now: its folder and its foreground command. */
  ptyStates: () => invoke<Record<string, { cwd: string | null; command: string | null }>>("pty_states"),
  ptyKill: (id: string) => invoke<void>("pty_kill", { id }),
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  /** The PNG's path, or null when the user pressed Esc. The image is on the clipboard too. */
  screenshot: (id: string) => invoke<string | null>("screenshot", { id }),
};
