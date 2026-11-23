import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Branch, Branches, GitStatus } from "../types";
import { Icon } from "./Icons";

/** The branch chip in a pane header, and its menu: switch to a local branch, check out a
 *  remote one (tracking it), or create a branch from the filter's text. Git's own error shows
 *  in the menu when it refuses (uncommitted changes the switch would overwrite). */
export function BranchChip({ path, git }: { path: string; git: GitStatus }) {
  // Where the chip is: the menu is fixed to the window, since the pane clips what overflows it.
  const [open, setOpen] = useState<DOMRect | null>(null);
  return (
    <span className="shrink-0">
      <button
        data-branch-chip
        onClick={(e) => setOpen(open ? null : e.currentTarget.getBoundingClientRect())}
        title="Switch branch"
        className={[
          "flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors",
          open ? "bg-white/[0.12] text-fg" : "bg-white/5 text-muted hover:bg-white/[0.1] hover:text-fg",
        ].join(" ")}
      >
        <Icon name="branch" className="h-3 w-3" />
        {git.branch}
        {git.ahead > 0 && <span className="text-status-todo">↑{git.ahead}</span>}
        {git.behind > 0 && <span className="text-status-progress">↓{git.behind}</span>}
        <Icon name="chevron" className="h-2.5 w-2.5 rotate-90 opacity-60" />
      </button>
      {open && <BranchMenu path={path} at={open} onClose={() => setOpen(null)} />}
    </span>
  );
}

function BranchMenu({ path, at: anchor, onClose }: { path: string; at: DOMRect; onClose: () => void }) {
  const [branches, setBranches] = useState<Branches | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.gitBranches(path).then(setBranches, (e) => setError(String(e)));
  }, [path]);

  useEffect(() => {
    // A press on the chip is left to its click, which closes the menu.
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest("[data-branch-chip]")) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onClose]);

  const t = q.trim().toLowerCase();
  const match = (b: Branch) => !t || b.name.toLowerCase().includes(t);
  const local = (branches?.local ?? []).filter(match);
  const remote = (branches?.remote ?? []).filter(match);
  const exact = [...(branches?.local ?? []), ...(branches?.remote ?? [])].some((b) => b.name === q.trim());
  const canCreate = q.trim() !== "" && !exact && !/\s/.test(q.trim());
  // One list for the arrow keys: local, remote, then "create".
  type Row = { kind: "local" | "remote" | "create" | "publish"; name: string };
  const rows: Row[] = [
    ...local.map((b) => ({ kind: "local" as const, name: b.name })),
    ...remote.map((b) => ({ kind: "remote" as const, name: b.name })),
    ...(canCreate ? [{ kind: "create" as const, name: q.trim() }, { kind: "publish" as const, name: q.trim() }] : []),
  ];
  const at = Math.min(pick, Math.max(0, rows.length - 1));

  const go = async (row: Row) => {
    if (busy || (row.kind === "local" && row.name === branches?.current)) return onClose();
    setBusy(true);
    setError(null);
    const create = row.kind === "create" || row.kind === "publish";
    try {
      await api.gitSwitch(path, row.name, create, row.kind === "remote");
    } catch (e) {
      setError(String(e));
      setBusy(false);
      return;
    }
    // The branch exists now; a failed push leaves it local, with git's error shown.
    try {
      if (row.kind === "publish") await api.gitPublish(path);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") setPick(Math.min(rows.length - 1, at + 1));
    else if (e.key === "ArrowUp") setPick(Math.max(0, at - 1));
    else if (e.key === "Enter" && rows[at]) go(rows[at]);
    else return;
    e.preventDefault();
  };

  const row = (r: Row, i: number, b?: Branch) => (
    <button
      key={`${r.kind}:${r.name}`}
      onClick={() => go(r)}
      onMouseEnter={() => setPick(i)}
      className={["flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]", i === at ? "bg-[#04395e] text-white" : "text-text"].join(" ")}
    >
      <span className="w-3.5 shrink-0">
        {r.kind === "local" && r.name === branches?.current && <Icon name="check" className="h-3.5 w-3.5" />}
        {r.kind === "create" && <Icon name="plus" className="h-3.5 w-3.5" />}
        {r.kind === "publish" && <Icon name="pull" className="h-3.5 w-3.5 rotate-180" />}
      </span>
      <span className="truncate font-mono text-[12px]">
        {r.kind === "create" ? `Create branch ${r.name}` : r.kind === "publish" ? `Create and push ${r.name}` : r.name}
      </span>
      {b?.when && <span className="ml-auto shrink-0 pl-3 text-[11px] text-muted">{b.when}</span>}
    </button>
  );

  return (
    <div
      ref={box}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ left: Math.min(anchor.left, window.innerWidth - 352), top: anchor.bottom + 6 }}
      className="fixed z-50 w-[340px] rounded-lg bg-card p-1.5 shadow-float ring-1 ring-inset ring-white/[0.2]"
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPick(0);
        }}
        onKeyDown={onKey}
        placeholder="Switch to a branch, or type a new name"
        spellCheck={false}
        className="mb-1 h-[26px] w-full rounded-[4px] border border-[#3c3c3c] bg-[#313131] px-2 font-mono text-[12px] text-text placeholder:font-sans placeholder:text-[#989898] focus:border-[#0078d4] focus:outline-none"
      />
      {error && (
        <div className="mb-1 whitespace-pre-wrap rounded-[4px] border border-[#be1100] bg-[#5a1d1d] px-2 py-1.5 font-mono text-[11.5px] text-[#f48771]">{error}</div>
      )}
      <div className="max-h-[320px] overflow-y-auto">
        {!branches && !error && <div className="px-2 py-2 text-[12px] text-muted">Loading branches…</div>}
        {local.length > 0 && <Heading>Local</Heading>}
        {local.map((b, i) => row(rows[i], i, b))}
        {remote.length > 0 && <Heading>Remote</Heading>}
        {remote.map((b, i) => row(rows[local.length + i], local.length + i, b))}
        {canCreate && row(rows[rows.length - 2], rows.length - 2)}
        {canCreate && row(rows[rows.length - 1], rows.length - 1)}
        {branches && rows.length === 0 && <div className="px-2 py-2 text-[12px] text-muted">No branch matches.</div>}
      </div>
      {busy && <div className="px-2 pt-1 text-[11px] text-muted">Working…</div>}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-muted">{children}</div>;
}
