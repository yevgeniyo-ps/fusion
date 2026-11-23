import { useEffect, useState } from "react";
import { api } from "../api";
import type { GitStatus } from "../types";
import { onFsChange, touches } from "./fsEvents";

// One git status per project, shared by all that show it (its pane, the terminal's pull
// count). It is read only while an open tab shows the project. A change in a hidden tab only
// marks the status old; it is read again when that tab opens.

type Entry = {
  status: GitStatus | null;
  /** Readers, and how many of them are in an open tab. */
  subs: Set<(s: GitStatus) => void>;
  live: number;
  stale: boolean;
  /** A read runs; `again`: something changed meanwhile, read once more after it. */
  busy: boolean;
  again: boolean;
  timer: number;
};
const entries = new Map<string, Entry>();

function entry(path: string): Entry {
  let e = entries.get(path);
  if (!e) {
    e = { status: null, subs: new Set(), live: 0, stale: true, busy: false, again: false, timer: 0 };
    entries.set(path, e);
  }
  return e;
}

async function read(path: string, e: Entry) {
  if (e.busy) {
    e.again = true;
    return;
  }
  e.busy = true;
  e.stale = false;
  try {
    const s = await api.gitStatus(path);
    e.status = s;
    e.subs.forEach((f) => f(s));
  } catch {
    /* not readable now: the next change tries again */
  } finally {
    e.busy = false;
    if (e.again) {
      e.again = false;
      read(path, e);
    }
  }
}

/** Read now if an open tab shows it, else mark it old. A burst of changes (a checkout,
 *  claude's edits) is one read, 250 ms after the last. */
function changed(path: string, e: Entry, wait = 250) {
  if (e.live === 0) {
    e.stale = true;
    return;
  }
  clearTimeout(e.timer);
  e.timer = window.setTimeout(() => read(path, e), wait);
}

let started = false;
function start() {
  if (started) return;
  started = true;
  onFsChange((paths) => {
    for (const [path, e] of entries) if (touches(paths, path)) changed(path, e);
  });
  // The window comes back (a commit made in another app), and a slow fallback for changes
  // the watcher cannot see (a folder outside the project).
  const all = () => entries.forEach((e, path) => changed(path, e, 0));
  window.addEventListener("focus", all);
  setInterval(all, 30_000);
}

/** The git status of each path, read while `on`. A path not read yet is absent. */
export function useGitStatuses(paths: string[], on: boolean): Record<string, GitStatus> {
  const key = paths.join("\n");
  const [out, setOut] = useState<Record<string, GitStatus>>(() => current(paths));
  useEffect(() => {
    start();
    const list = key ? key.split("\n") : [];
    setOut(current(list));
    const offs = list.map((path) => {
      const e = entry(path);
      const f = (s: GitStatus) => setOut((o) => (o[path] === s ? o : { ...o, [path]: s }));
      e.subs.add(f);
      if (on) {
        e.live++;
        if (e.stale || !e.status) read(path, e);
      }
      return () => {
        e.subs.delete(f);
        if (on) e.live--;
        if (e.subs.size === 0) {
          clearTimeout(e.timer);
          entries.delete(path);
        }
      };
    });
    return () => offs.forEach((off) => off());
  }, [key, on]);
  return out;
}

/** Read again now (after a fetch): the behind count may have moved. */
export function refreshGit(path: string) {
  const e = entries.get(path);
  if (e) changed(path, e, 0);
}

export function useGitStatus(path: string, on: boolean): GitStatus | null {
  return useGitStatuses([path], on)[path] ?? null;
}

function current(paths: string[]): Record<string, GitStatus> {
  const o: Record<string, GitStatus> = {};
  for (const p of paths) {
    const s = entries.get(p)?.status;
    if (s) o[p] = s;
  }
  return o;
}
