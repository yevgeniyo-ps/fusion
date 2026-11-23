import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { refreshGit, useGitStatuses } from "./gitStatus";

// Commits on the remote that are not pulled yet: a background fetch keeps the behind count
// true, and the shared git status reads it. Shared by every tab: a project is fetched once per period.

const FETCH_EVERY = 3 * 60 * 1000;
const lastFetch = new Map<string, number>();
const fetching = new Map<string, Promise<boolean>>();

function fetchOnce(path: string): Promise<boolean> {
  const running = fetching.get(path);
  if (running) return running;
  if (Date.now() - (lastFetch.get(path) ?? 0) < FETCH_EVERY - 5000) return Promise.resolve(true);
  const p = api.gitFetch(path).catch(() => false).finally(() => {
    lastFetch.set(path, Date.now());
    fetching.delete(path);
  });
  fetching.set(path, p);
  return p;
}

export interface Incoming {
  /** Commits to pull, by project path. */
  behind: Record<string, number>;
  total: number;
  /** A fetch is running. */
  checking: boolean;
}

/** The incoming commits of these projects, while `on` (the tab is open). The count comes
 *  from the shared git status (lib/gitStatus); a fetch every few minutes keeps it true. */
export function useIncoming(paths: string[], on: boolean): Incoming {
  const statuses = useGitStatuses(paths, on);
  const [checking, setChecking] = useState(false);
  const key = paths.join("\n");

  useEffect(() => {
    if (!on) return;
    let gone = false;
    const list = key ? key.split("\n") : [];
    const fetchAll = async () => {
      setChecking(true);
      await Promise.all(list.map((p) => fetchOnce(p).then(() => refreshGit(p))));
      if (!gone) setChecking(false);
    };
    fetchAll();
    const every = setInterval(fetchAll, FETCH_EVERY);
    return () => {
      gone = true;
      clearInterval(every);
    };
  }, [key, on]);

  const behind = useMemo(() => Object.fromEntries(paths.map((p) => [p, statuses[p]?.repo ? statuses[p].behind : 0])), [statuses, key]);
  const total = Object.values(behind).reduce((a, b) => a + b, 0);
  return { behind, total, checking };
}
