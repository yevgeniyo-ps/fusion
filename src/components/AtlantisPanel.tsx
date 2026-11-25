import { useEffect, useRef, useState } from "react";
import { api, type AtlantisState } from "../api";
import type { Project } from "../types";
import { useGitStatus } from "../lib/gitStatus";
import { Icon } from "./Icons";
import logo from "../assets/atlantis.png";

type Comment = AtlantisState["comments"][number];

/** Atlantis's own logo (runatlantis.io, Apache-2.0): an island in a circle. */
export function AtlantisLogo({ className = "h-4 w-4" }: { className?: string }) {
  return <img src={logo} alt="" aria-hidden draggable={false} className={`shrink-0 ${className}`} />;
}

/** The Atlantis plugin, a block at the right of the tab for one project's checkout: the PR of
 *  its branch, the Atlantis projects the PR changes, Plan / Apply / Unlock (posted as PR
 *  comments), Atlantis's answers, and merging the PR. It reads again every 30 s, and every
 *  5 s after a command until Atlantis answers. */
export function AtlantisPanel({ project, live, onClose }: { project: Project; live: boolean; onClose: () => void }) {
  const path = project.path;
  const branch = useGitStatus(path, live)?.branch ?? "";
  const [st, setSt] = useState<AtlantisState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // "" = every changed project (no -p).
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState(false);
  // A command posted, waiting for Atlantis: how many of its comments there were before.
  const [waiting, setWaiting] = useState<{ command: string; bots: number } | null>(null);
  const alive = useRef(true);
  const [method, setMethod] = useState<"squash" | "merge" | "rebase">("squash");
  const [bypass, setBypass] = useState(false);
  const [merging, setMerging] = useState<"idle" | "confirm" | "busy">("idle");

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.atlantisState(path);
      if (!alive.current) return;
      setSt(s);
      setError(null);
      setWaiting((w) => (w && s.comments.filter((c) => c.bot).length > w.bots ? null : w));
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
    // A new branch: its own PR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, branch]);

  useEffect(() => {
    const t = setInterval(load, waiting ? 5000 : 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, path]);

  const run = (verb: "plan" | "apply" | "unlock") => {
    if (verb === "apply" && !confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    runCommand(`atlantis ${verb}${target && verb !== "unlock" ? ` -p ${target}` : ""}`);
  };

  const runCommand = async (command: string) => {
    if (!st?.pr) return;
    setWaiting({ command, bots: st.comments.filter((c) => c.bot).length });
    try {
      await api.atlantisRun(path, st.pr.number, command);
      load();
    } catch (e) {
      setWaiting(null);
      setError(String(e));
    }
  };

  const merge = async () => {
    if (!st?.pr) return;
    if (merging === "idle") {
      setMerging("confirm");
      return;
    }
    setMerging("busy");
    try {
      await api.atlantisMerge(path, st.pr.number, method, bypass);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      if (alive.current) setMerging("idle");
    }
  };

  const pr = st?.pr;
  const open = pr?.state === "OPEN";
  const changed = st?.changed ?? [];

  return (
    <section tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md rounded-br-[var(--corner-radius)] tab-edge bg-panel text-[12.5px]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[#2b2b2b] px-3">
        <AtlantisLogo className="h-4 w-4" />
        <span className="text-[13px] font-bold text-text">Atlantis</span>
        <span className="truncate text-[12px] text-muted">{project.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {pr && (
            <button onClick={() => api.openUrl(pr.url)} title="Open the PR on GitHub" className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg">
              <Icon name="github" className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={load} title="Read again" className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg">
            <Icon name="pull" className={["h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} />
          </button>
          <button onClick={onClose} title="Close the Atlantis panel" className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        </span>
      </header>
      <div className="flex shrink-0 flex-col gap-2 border-b border-[#2b2b2b] px-4 py-3">
        {pr && (
          <div className="flex items-start gap-2">
            <button onClick={() => api.openUrl(pr.url)} title={pr.url} className="line-clamp-2 min-w-0 text-left text-[13px] font-medium text-fg hover:underline">
              #{pr.number} {pr.title}
            </button>
            <span className={["mt-0.5 shrink-0 rounded-full px-1.5 text-[10.5px]", open ? "bg-[#6cd17b]/15 text-[#6cd17b]" : pr.state === "MERGED" ? "bg-[#c58af9]/15 text-[#c58af9]" : "bg-white/[0.08] text-muted"].join(" ")}>
              {pr.draft && open ? "draft" : pr.state.toLowerCase()}
            </span>
          </div>
        )}
        {error && <div className="text-[#f28b82]">{error}</div>}
        {st && !pr && <div className="text-muted">No pull request for {branch || "this branch"}. Push it and open one: Atlantis runs on PRs.</div>}
        {pr && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">Projects</span>
              <Chip on={target === ""} onClick={() => setTarget("")} title="Every project this PR changes (no -p)">
                all changed{changed.length ? ` (${changed.length})` : ""}
              </Chip>
              {changed.map((n) => (
                <Chip key={n} on={target === n} onClick={() => setTarget(n)} title={`-p ${n}`}>
                  {n}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button disabled={!open || !!waiting} onClick={() => run("plan")} className="rounded-md bg-white px-3.5 py-1 font-medium text-black hover:bg-white/90 disabled:opacity-40">
                Plan
              </button>
              <button
                disabled={!open || !!waiting}
                onClick={() => run("apply")}
                onBlur={() => setConfirm(false)}
                className={["rounded-md px-3.5 py-1 ring-1 ring-inset disabled:opacity-40", confirm ? "bg-[#f4a93a] font-medium text-black ring-transparent" : "text-[#f4a93a] ring-[#f4a93a]/50 hover:bg-[#f4a93a]/10"].join(" ")}
              >
                {confirm ? `Confirm apply${target ? ` ${target}` : ""}` : "Apply"}
              </button>
              <button disabled={!open || !!waiting} onClick={() => run("unlock")} title="atlantis unlock: drop this PR's locks and plans" className="ml-auto rounded-md px-3 py-1 text-muted ring-1 ring-inset ring-white/[0.12] hover:text-fg disabled:opacity-40">
                Unlock
              </button>
            </div>
            {waiting && (
              <div className="flex min-w-0 items-center gap-2 rounded-md bg-[#d97757]/10 px-2.5 py-1.5 text-[#e9a487]">
                <span className="tab-brewing h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97757]" />
                <code className="min-w-0 truncate font-mono text-[11.5px]">{waiting.command}</code>
                <span className="ml-auto shrink-0 text-[11.5px]">waiting for Atlantis…</span>
              </div>
            )}
          </>
        )}
      </div>
      {pr && open && (
        <div className="mx-3 mt-3 flex shrink-0 flex-col gap-2 rounded-lg bg-white/[0.03] px-3 py-2.5 ring-1 ring-inset ring-white/[0.08]">
          <div className="flex items-center gap-2 text-muted">
            <span className="text-[11px] font-bold uppercase tracking-[0.04em]">Merge</span>
            <span className="truncate">into {pr.base}</span>
            <span className={["ml-auto shrink-0", mergeTone(pr)].join(" ")}>{mergeNote(pr)}</span>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-[#f28b82]">
            <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} className="mt-0.5 shrink-0 accent-[#f28b82]" />
            Merge without waiting for requirements to be met (bypass rules)
          </label>
          <div className="flex items-center gap-2">
            <select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value as typeof method);
                setMerging("idle");
              }}
              className="h-[26px] rounded-md border border-[#3c3c3c] bg-[#1c1d20] px-1.5 text-[12px] text-text outline-none"
            >
              <option value="squash">Squash and merge</option>
              <option value="merge">Create a merge commit</option>
              <option value="rebase">Rebase and merge</option>
            </select>
            <button
              disabled={merging === "busy" || pr.draft}
              onClick={merge}
              onBlur={() => merging === "confirm" && setMerging("idle")}
              className={["rounded-md px-3 py-1", merging === "confirm" ? (bypass ? "bg-[#f28b82] font-medium text-black" : "bg-[#6cd17b] font-medium text-black") : "glass-btn"].join(" ")}
            >
              {merging === "busy" ? "Merging…" : merging === "confirm" ? `Confirm${bypass ? " (bypass)" : ""}` : METHOD_LABEL[method]}
            </button>
          </div>
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 select-text">
        {pr && st && st.comments.length === 0 && <div className="text-muted">No Atlantis activity on this PR yet.</div>}
        <div className="flex flex-col gap-2.5">
          {[...(st?.comments ?? [])].reverse().map((c, i, list) => (
            <CommentCard key={c.url || c.created_at} c={c} latest={c.bot && list.findIndex((x) => x.bot) === i} onRun={runCommand} busy={!open || !!waiting} />
          ))}
        </div>
      </div>
    </section>
  );
}

const METHOD_LABEL = { squash: "Squash and merge", merge: "Merge", rebase: "Rebase and merge" };

type Pr = NonNullable<AtlantisState["pr"]>;

/** What GitHub says about merging now, in a few words. */
function mergeNote(pr: Pr): string {
  if (pr.draft) return "draft: mark it ready on GitHub";
  if (pr.mergeable === "CONFLICTING" || pr.merge_state === "DIRTY") return "conflicts";
  if (pr.review === "CHANGES_REQUESTED") return "changes requested";
  if (pr.merge_state === "BLOCKED") return pr.review === "REVIEW_REQUIRED" ? "review required" : "blocked by rules";
  if (pr.merge_state === "BEHIND") return "behind the base branch";
  if (pr.merge_state === "UNSTABLE") return "checks failing";
  if (pr.merge_state === "CLEAN" || pr.merge_state === "HAS_HOOKS") return "ready to merge";
  return "checking…";
}

function mergeTone(pr: Pr): string {
  const n = mergeNote(pr);
  return n === "ready to merge" ? "text-[#6cd17b]" : n === "checking…" ? "text-faint" : "text-[#e2c08d]";
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={["max-w-full truncate rounded-full px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset", on ? "bg-white/[0.14] text-fg ring-white/30" : "text-muted ring-white/[0.12] hover:text-fg"].join(" ")}
    >
      {children}
    </button>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const COMMAND = /^atlantis (plan|apply|unlock)( -p [A-Za-z0-9._/-]+)?$/;

interface Parsed {
  kind: "ok" | "error" | "info";
  title: string;
  project: string;
  counts: { add: number; change: number; destroy: number } | null;
  noChanges: boolean;
  output: string;
  /** Atlantis's own suggestions ("To apply this plan, comment: …"). */
  commands: string[];
  /** Links it gives (the lock page). */
  links: { label: string; url: string }[];
  /** Whatever else it says, as plain lines. */
  text: string[];
}

/** An Atlantis comment, taken apart: what ran, on which project, the plan's numbers, the
 *  output, and the commands it suggests. The rest is its boilerplate. */
export function parse(body: string): Parsed {
  // Shown as text, never as HTML; the markup is dropped until none is left (a removal can
  // join the halves of another tag).
  let clean = body;
  for (let prev = ""; prev !== clean; ) {
    prev = clean;
    clean = clean.replace(/<\/?details>|<summary>.*?<\/summary>|<!--[\s\S]*?-->|<br\s*\/?>/g, "");
  }
  const parts = clean.split(/```[a-z]*\n?/);
  const code = parts.filter((_, i) => i % 2 === 1).map((p) => p.replace(/\n$/, ""));
  const prose = parts.filter((_, i) => i % 2 === 0).join("\n");
  const commands = [...new Set(code.map((c) => c.trim()).filter((c) => COMMAND.test(c)))];
  const output = code.filter((c) => !COMMAND.test(c.trim())).join("\n\n");
  const ran = /Ran (Plan|Apply|Import|State \w+|Policy Check)[^\n]*?project: `([^`]+)`/.exec(prose) ?? /Ran (Plan|Apply)[^\n]*?dir: `([^`]+)`/.exec(prose);
  const error = /\*\*(Plan|Apply|Import|Unlock|Policy Check)? ?(Error|Failed)\*\*|(Plan|Apply) Failed/.exec(prose);
  const all = prose + "\n" + output;
  const plan = /Plan: (\d+) to (?:import, (\d+) to )?add, (\d+) to change, (\d+) to destroy/.exec(all);
  const applied = /Resources: (?:(\d+) imported, )?(\d+) added, (\d+) changed, (\d+) destroyed/.exec(all);
  // "Plan: 1 to import, 2 to add, …": with an import, the add count is the second number.
  const counts = plan
    ? { add: +(plan[2] ?? plan[1]), change: +plan[3], destroy: +plan[4] }
    : applied
      ? { add: +applied[2], change: +applied[3], destroy: +applied[4] }
      : null;
  const links = [...prose.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g)]
    .filter((m) => !/\/commit|\/pull\//.test(m[2]))
    .map((m) => ({ label: /lock/i.test(m[2]) ? "Lock page" : m[1] === "here" ? "Open" : m[1], url: m[2] }));
  const unlocked = /Locks and plans deleted|All Atlantis locks/.test(prose);
  const text = prose
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "---" && !/^Ran (Plan|Apply)/.test(l) && !/^\*\s*:[a-z_]+:/.test(l) && !/^\*\*.*(Error|Failed)\*\*$/.test(l) && !/^Plan: \d/.test(l) && !/^- (Commit|Blocking job):/.test(l))
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/:[a-z_]+:\s*/g, ""));
  const kind = error ? "error" : ran || unlocked ? "ok" : "info";
  const verb = error ? `${error[1] ?? error[3] ?? ""} ${error[2] ?? "failed"}`.trim() : ran ? ran[1] : unlocked ? "Unlocked" : "Atlantis";
  return {
    kind,
    title: verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase(),
    project: ran?.[2] ?? "",
    counts,
    noChanges: /No changes\. (Your infrastructure|Infrastructure) matches/.test(all),
    output,
    commands,
    links,
    text,
  };
}

const TONE = {
  ok: { dot: "bg-[#6cd17b]", ring: "ring-[#6cd17b]/25", text: "text-[#6cd17b]" },
  error: { dot: "bg-[#f28b82]", ring: "ring-[#f28b82]/35", text: "text-[#f28b82]" },
  info: { dot: "bg-white/40", ring: "ring-white/[0.1]", text: "text-muted" },
};

function CommentCard({ c, latest, onRun, busy }: { c: Comment; latest: boolean; onRun: (command: string) => void; busy: boolean }) {
  if (!c.bot) {
    return (
      <div className="flex min-w-0 items-center gap-2 pl-1 text-[11.5px] text-faint">
        <span className="h-1 w-1 shrink-0 rounded-full bg-white/30" />
        <code className="min-w-0 truncate rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-text">{c.body.trim()}</code>
        <span className="truncate">{c.author}</span>
        <span className="ml-auto shrink-0">{when(c.created_at)}</span>
      </div>
    );
  }
  return <BotCard c={c} latest={latest} onRun={onRun} busy={busy} />;
}

/** An Atlantis answer. Only the newest is open; the older ones fold to one line (a click
 *  opens one). */
function BotCard({ c, latest, onRun, busy }: { c: Comment; latest: boolean; onRun: (command: string) => void; busy: boolean }) {
  const [picked, setPicked] = useState<boolean | null>(null);
  const open = picked ?? latest;
  const p = parse(c.body);
  const tone = TONE[p.kind];
  return (
    <div className={["min-w-0 overflow-hidden rounded-lg ring-1 ring-inset", open ? "bg-white/[0.03]" : "bg-white/[0.015] opacity-75 hover:opacity-100", tone.ring].join(" ")}>
      <div onClick={() => setPicked(!open)} className={["flex min-w-0 cursor-default items-center gap-2 px-3", open ? "pt-2.5" : "py-2"].join(" ")}>
        <Icon name="chevron" className={["h-3 w-3 shrink-0 text-faint transition-transform", open ? "rotate-90" : ""].join(" ")} />
        <span className={["h-2 w-2 shrink-0 rounded-full", tone.dot].join(" ")} />
        <span className={["shrink-0 text-[12.5px] font-semibold", tone.text].join(" ")}>{p.title}</span>
        {p.project && (
          <span className="min-w-0 truncate font-mono text-[11.5px] text-text" title={p.project}>
            {p.project}
          </span>
        )}
        {!open && p.counts && (
          <span className="shrink-0 font-mono text-[10.5px]">
            <span className="text-[#6cd17b]">+{p.counts.add}</span> <span className="text-[#e2c08d]">~{p.counts.change}</span>{" "}
            <span className={p.counts.destroy ? "text-[#f28b82]" : "text-faint"}>−{p.counts.destroy}</span>
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            api.openUrl(c.url);
          }}
          title="Open the comment on GitHub"
          className="ml-auto shrink-0 text-[11px] text-faint hover:text-fg"
        >
          {when(c.created_at)}
        </button>
      </div>
      {open && (
      <div className="flex min-w-0 flex-col gap-2 px-3 pb-3 pt-2">
        {(p.counts || p.noChanges) && (
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            {p.noChanges && !p.counts ? (
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-muted">no changes</span>
            ) : (
              p.counts && (
                <>
                  <span className="rounded bg-[#6cd17b]/12 px-1.5 py-0.5 text-[#6cd17b]">+{p.counts.add} add</span>
                  <span className="rounded bg-[#e2c08d]/12 px-1.5 py-0.5 text-[#e2c08d]">~{p.counts.change} change</span>
                  <span className={["rounded px-1.5 py-0.5", p.counts.destroy ? "bg-[#f28b82]/15 text-[#f28b82]" : "bg-white/[0.06] text-muted"].join(" ")}>−{p.counts.destroy} destroy</span>
                </>
              )
            )}
          </div>
        )}
        {p.text.length > 0 && (
          <div className="min-w-0 whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{p.text.join("\n")}</div>
        )}
        {p.output && <Output text={p.output} open />}
        {((latest && p.commands.length > 0) || p.links.length > 0) && (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {latest && p.commands.map((cmd) => (
              <CommandChip key={cmd} command={cmd} onRun={onRun} disabled={busy} />
            ))}
            {p.links.map((l) => (
              <button key={l.url} onClick={() => api.openUrl(l.url)} title={l.url} className="rounded-md px-2 py-1 text-[11.5px] text-muted ring-1 ring-inset ring-white/[0.12] hover:text-fg">
                {l.label} ↗
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

/** A command Atlantis suggests: one click runs it; apply asks once more. */
function CommandChip({ command, onRun, disabled }: { command: string; onRun: (command: string) => void; disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const apply = command.startsWith("atlantis apply");
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (apply && !confirm) return setConfirm(true);
        setConfirm(false);
        onRun(command);
      }}
      onBlur={() => setConfirm(false)}
      title={confirm ? "Click again to run it" : `Run: ${command}`}
      className={[
        "flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] ring-1 ring-inset disabled:opacity-40",
        confirm ? "bg-[#f4a93a] text-black ring-transparent" : "bg-black/30 text-text ring-white/[0.12] hover:bg-white/[0.08] hover:text-fg",
      ].join(" ")}
    >
      <span className="shrink-0">{confirm ? "Confirm" : "▶"}</span>
      <span className="min-w-0 truncate">{command}</span>
    </button>
  );
}

/** Terraform's output: collapsed but for the newest answer, + / - / ~ coloured, scrolling
 *  inside its box. */
function Output({ text, open }: { text: string; open: boolean }) {
  const [shown, setShown] = useState(open);
  const lines = text.split("\n");
  return (
    <div className="min-w-0">
      <button onClick={() => setShown((v) => !v)} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-fg">
        <Icon name="chevron" className={["h-3 w-3 transition-transform", shown ? "rotate-90" : ""].join(" ")} />
        {shown ? "Hide output" : `Show output · ${lines.length} lines`}
      </button>
      {shown && (
        <pre className="mt-1.5 max-h-[420px] min-w-0 overflow-auto rounded-md bg-black/45 px-3 py-2 font-mono text-[11px] leading-[1.55] text-[#cfcfcf] ring-1 ring-inset ring-white/[0.06]">
          {lines.map((l, j) => (
            <div key={j} className={/^\s*\+/.test(l) ? "text-[#6cd17b]" : /^\s*-/.test(l) ? "text-[#f28b82]" : /^\s*~/.test(l) ? "text-[#e2c08d]" : /^\s*[│╷╵]/.test(l) ? "text-[#e2c08d]/80" : ""}>
              {l || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
