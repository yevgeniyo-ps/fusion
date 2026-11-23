import type { GitStatus } from "../types";

/** Changed files of a project, by absolute path. An untracked folder ("dir/") covers its files. */
export class Changes {
  private files = new Map<string, string>();
  private untrackedDirs: string[] = [];

  constructor(git: GitStatus | null) {
    for (const [path, code] of git?.files ?? []) {
      if (path.endsWith("/")) this.untrackedDirs.push(path);
      else this.files.set(path, code);
    }
  }

  get size() {
    return this.files.size + this.untrackedDirs.length;
  }

  /** M, A, D, U or R; undefined for an unchanged file. */
  code(path: string): string | undefined {
    return this.files.get(path) ?? (this.untrackedDirs.some((d) => path.startsWith(d)) ? "U" : undefined);
  }

  /** Something in this folder changed. */
  inDir(dir: string): boolean {
    const prefix = dir + "/";
    if (this.untrackedDirs.some((d) => d.startsWith(prefix) || prefix.startsWith(d))) return true;
    for (const p of this.files.keys()) if (p.startsWith(prefix)) return true;
    return false;
  }

  list(): [string, string][] {
    return [...this.files.entries(), ...this.untrackedDirs.map((d): [string, string] => [d, "U"])].sort((a, b) => a[0].localeCompare(b[0]));
  }
}

// VS Code's git decoration colours.
export const CODE_COLOR: Record<string, string> = {
  M: "text-[#e2c08d]",
  A: "text-[#81b88b]",
  U: "text-[#73c991]",
  R: "text-[#73c991]",
  D: "text-[#c74e39]",
};
