import { listen } from "@tauri-apps/api/event";

// "fs-changed" from src-tauri/src/watch.rs: the paths that changed on disk in the last 150 ms.
type Listener = (paths: string[]) => void;
const listeners = new Set<Listener>();
let started = false;

export function onFsChange(fn: Listener): () => void {
  if (!started) {
    started = true;
    listen<string[]>("fs-changed", (e) => listeners.forEach((l) => l(e.payload))).catch(console.error);
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Did `path` change: it, something in it, or a folder above it (a rescan names the root)? */
export const touches = (paths: string[], path: string) =>
  paths.some((p) => p === path || p.startsWith(path + "/") || path.startsWith(p + "/"));

export const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
