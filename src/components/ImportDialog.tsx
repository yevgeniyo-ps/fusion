import { useMemo, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type GhRepo, type ImportEvent } from "../api";
import type { Project } from "../types";
import { Modal } from "./Modal";
import { Icon } from "./Icons";

const ORG_KEY = "fusion.import.org";
const PARENT_KEY = "fusion.clone.parent";

const saved = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private storage: not remembered */
  }
};

type Status = { state: "waiting" | "cloning" | "cloned" | "added" | "failed"; line?: string };

/** "2026-11-23T12:51:51Z" -> "today", "3 days ago", "Mar 2024". */
function when(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Import from GitHub: an org's repos, pick some, a folder, and each is checked out there (or
 *  found checked out already) and added as a project. */
export function ImportDialog({ open: shown, onClose, onProject }: { open: boolean; onClose: () => void; onProject: (p: Project) => void }) {
  const [org, setOrg] = useState(() => saved(ORG_KEY, ""));
  const [parent, setParent] = useState(() => saved(PARENT_KEY, "~/code"));
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [owner, setOwner] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<Record<string, Status> | null>(null);
  const running = status !== null && Object.values(status).some((s) => s.state === "waiting" || s.state === "cloning");

  const load = async () => {
    if (!org.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const listing = await api.githubRepos(org, parent);
      setRepos(listing.repos);
      setOwner(listing.owner);
      setPicked(new Set());
      save(ORG_KEY, org.trim());
    } catch (e) {
      setError(String(e));
      setRepos(null);
    } finally {
      setLoading(false);
    }
  };

  const shownRepos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (repos ?? []).filter((r) => (archived || !r.archived) && (!t || `${r.name} ${r.description}`.toLowerCase().includes(t)));
  }, [repos, q, archived]);

  const togglePick = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(name)) n.add(name);
      return n;
    });
  const allShown = shownRepos.length > 0 && shownRepos.every((r) => picked.has(r.full_name));
  const pickAll = () =>
    setPicked((p) => {
      const n = new Set(p);
      for (const r of shownRepos) allShown ? n.delete(r.full_name) : n.add(r.full_name);
      return n;
    });

  const pickParent = async () => {
    const dir = await open({ directory: true, defaultPath: parent.startsWith("~") ? undefined : parent });
    if (typeof dir === "string") setParent(dir);
  };

  const run = async () => {
    const list = [...picked];
    if (list.length === 0) return;
    save(PARENT_KEY, parent);
    const names = Object.fromEntries(list.map((full) => [full.split("/").pop()!, { state: "waiting" } as Status]));
    setStatus(names);
    const events = new Channel<ImportEvent>();
    events.onmessage = (e) => {
      setStatus((s) => {
        if (!s) return s;
        const next = { ...s };
        if (e.kind === "progress") next[e.name] = { state: "cloning", line: e.line };
        else if (e.kind === "done") next[e.name] = { state: e.cloned ? "cloned" : "added" };
        else next[e.name] = { state: "failed", line: e.error };
        return next;
      });
      if (e.kind === "done") onProject(e.project);
    };
    try {
      await api.githubImport(parent, list, events);
    } catch (e) {
      setError(String(e));
    }
  };

  const reset = () => {
    setStatus(null);
    setPicked(new Set());
    load();
  };

  const field = "h-[28px] w-full rounded-[4px] border border-[#3c3c3c] bg-[#313131] px-2 text-[13px] text-text placeholder:text-[#989898] focus:border-[#0078d4] focus:outline-none";
  const primary = "h-[26px] rounded-[4px] bg-[#0078d4] px-3.5 text-[13px] text-white hover:bg-[#026ec1] disabled:opacity-40";
  const secondary = "h-[26px] rounded-[4px] bg-[#313131] px-3.5 text-[13px] text-text hover:bg-[#3c3c3c] disabled:opacity-40";

  const footer = status ? (
    <>
      <span className="mr-auto text-[12px] text-muted">{summary(status)}</span>
      {!running && (
        <button onClick={reset} className={secondary}>
          Import more
        </button>
      )}
      <button onClick={onClose} disabled={running} className={primary}>
        {running ? "Importing…" : "Done"}
      </button>
    </>
  ) : (
    <>
      <span className="mr-auto text-[12px] text-muted">{repos ? `${picked.size} selected` : ""}</span>
      <button onClick={onClose} className={secondary}>
        Cancel
      </button>
      <button onClick={run} disabled={picked.size === 0} className={primary}>
        Import {picked.size || ""}
      </button>
    </>
  );

  return (
    <Modal open={shown} onClose={running ? () => {} : onClose} title="Import from GitHub" wide footer={footer}>
      {status ? (
        <div className="flex max-h-[420px] flex-col gap-0.5 overflow-y-auto">
          {Object.entries(status).map(([name, s]) => (
            <div key={name} className="flex h-[26px] items-center gap-2.5 rounded-md px-2 text-[13px]">
              <StatusIcon state={s.state} />
              <span className="w-48 shrink-0 truncate text-text">{name}</span>
              <span className={["min-w-0 truncate font-mono text-[11.5px]", s.state === "failed" ? "text-[#f48771]" : "text-muted"].join(" ")}>
                {s.state === "cloned" ? "cloned" : s.state === "added" ? "already checked out: added" : s.state === "waiting" ? "waiting" : s.line}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[13px] text-text">GitHub org or user</span>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && load()}
                  placeholder="https://github.com/acme"
                  spellCheck={false}
                  className={`${field} font-mono`}
                />
                <button onClick={load} disabled={!org.trim() || loading} className={`${secondary} h-[28px] shrink-0`}>
                  {loading ? "Loading…" : repos ? "Reload" : "Show repos"}
                </button>
              </div>
            </label>
            <label className="flex w-64 flex-col gap-1.5">
              <span className="text-[13px] text-text">Check out into</span>
              <div className="flex gap-2">
                <input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} className={`${field} font-mono`} />
                <button onClick={pickParent} className={`${secondary} h-[28px] shrink-0 px-2.5`}>
                  …
                </button>
              </div>
            </label>
          </div>
          {loading && (
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="rel-progress h-full w-2/5 rounded-full bg-[#0078d4]" />
            </div>
          )}
          {error && <div className="rounded-[4px] border border-[#be1100] bg-[#5a1d1d] px-3 py-2 font-mono text-[12px] text-[#f48771]">{error}</div>}
          {repos && (
            <>
              <div className="flex items-center gap-3">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${repos.length} repos of ${owner}`} spellCheck={false} className={`${field} flex-1`} />
                <label className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted">
                  <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="accent-[#0078d4]" />
                  archived
                </label>
              </div>
              <div className="flex max-h-[360px] flex-col overflow-y-auto rounded-md border border-[#2b2b2b]">
                <label className="sticky top-0 z-10 flex h-[28px] shrink-0 items-center gap-2.5 border-b border-[#2b2b2b] bg-card px-2.5 text-[12px] text-muted">
                  <input type="checkbox" checked={allShown} onChange={pickAll} className="accent-[#0078d4]" />
                  {shownRepos.length} shown
                </label>
                {shownRepos.map((r) => (
                  <label key={r.full_name} className="flex min-h-[34px] cursor-pointer items-center gap-2.5 border-b border-white/[0.04] px-2.5 py-1 hover:bg-[#2a2d2e]">
                    <input type="checkbox" checked={picked.has(r.full_name)} onChange={() => togglePick(r.full_name)} className="shrink-0 accent-[#0078d4]" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] text-text">{r.name}</span>
                        <Badge text={r.visibility} />
                        {r.archived && <Badge text="archived" />}
                        {r.project ? <Badge text="in Fusion" tone="done" /> : r.exists ? <Badge text="checked out" tone="done" /> : null}
                      </span>
                      {r.description && <span className="truncate text-[11.5px] text-muted">{r.description}</span>}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-faint">{when(r.pushed_at)}</span>
                  </label>
                ))}
                {shownRepos.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-muted">No repo matches.</div>}
              </div>
              <p className="text-[11.5px] text-muted">
                A repo already checked out in the folder is not cloned again: it is only added as a project.
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function summary(status: Record<string, Status>): string {
  const v = Object.values(status);
  const n = (s: Status["state"]) => v.filter((x) => x.state === s).length;
  const parts = [n("cloned") && `${n("cloned")} cloned`, n("added") && `${n("added")} added`, n("failed") && `${n("failed")} failed`];
  const left = n("waiting") + n("cloning");
  return [...parts.filter(Boolean), left && `${left} to go`].filter(Boolean).join(" · ");
}

function Badge({ text, tone }: { text: string; tone?: "done" }) {
  return (
    <span
      className={[
        "shrink-0 rounded-full px-1.5 text-[10.5px] leading-[16px]",
        tone === "done" ? "bg-status-done/15 text-status-done" : "bg-white/[0.08] text-muted",
      ].join(" ")}
    >
      {text}
    </span>
  );
}

function StatusIcon({ state }: { state: Status["state"] }) {
  if (state === "cloned" || state === "added") return <Icon name="check" className="h-3.5 w-3.5 text-status-done" />;
  if (state === "failed") return <Icon name="close" className="h-3.5 w-3.5 text-[#f48771]" />;
  if (state === "cloning") return <Icon name="clone" className="h-3.5 w-3.5 animate-pulse text-[#4daafc]" />;
  return <span className="h-3.5 w-3.5 rounded-full border border-white/20" />;
}
