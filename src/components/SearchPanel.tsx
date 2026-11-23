import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Found, Hit } from "../types";
import { Icon } from "./Icons";

/** A match to open: the file, its 1-based line, and the match inside the line (UTF-16). */
export interface Jump {
  path: string;
  line: number;
  from: number;
  to: number;
}

const DEBOUNCE_MS = 250;

/** Find in the project's files, as VS Code's search view: the query, match case / whole word /
 *  regular expression, and the matching lines by file. A click opens the line. */
export function SearchPanel({ root, focusKey, onPick }: { root: string; focusKey: number; onPick: (j: Jump) => void }) {
  const [q, setQ] = useState("");
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // ⌘⇧F: the box gets the focus, its text selected (as VS Code does).
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  useEffect(() => {
    const n = ++seq.current;
    if (!q) {
      setFound(null);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      api.search(root, q, caseSensitive, wholeWord, regex).then(
        (f) => {
          // Only the latest query counts: an older one can finish later.
          if (n !== seq.current) return;
          setFound(f);
          setError(null);
          setBusy(false);
        },
        (e) => {
          if (n !== seq.current) return;
          setFound(null);
          setError(String(e));
          setBusy(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [root, q, caseSensitive, wholeWord, regex]);

  const groups = useMemo(() => {
    const by = new Map<string, Hit[]>();
    for (const h of found?.hits ?? []) {
      const list = by.get(h.path);
      if (list) list.push(h);
      else by.set(h.path, [h]);
    }
    return [...by];
  }, [found]);

  const toggle = (on: boolean, set: (v: boolean) => void, label: string, title: string) => (
    <button
      onClick={() => set(!on)}
      title={title}
      aria-pressed={on}
      className={[
        "flex h-[18px] min-w-[20px] items-center justify-center rounded-[3px] px-0.5 font-mono text-[11px] leading-none",
        on ? "bg-[#0078d4]/40 text-white ring-1 ring-inset ring-[#0078d4]" : "text-muted hover:bg-white/10 hover:text-fg",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col">
      <div className="px-2 pb-1.5 pt-1.5">
        <div className="flex h-[26px] items-center gap-0.5 rounded-[4px] border border-[#3c3c3c] bg-[#313131] pl-2 pr-1 focus-within:border-[#0078d4]">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-[#989898]"
          />
          {toggle(caseSensitive, setCase, "Aa", "Match case")}
          {toggle(wholeWord, setWord, "ab", "Match whole word")}
          {toggle(regex, setRegex, ".*", "Use regular expression")}
        </div>
        <div className="mt-1.5 min-h-[16px] px-0.5 text-[11.5px] text-muted">
          {error ? (
            <span className="text-[#f48771]">{error}</span>
          ) : busy ? (
            "Searching…"
          ) : found ? (
            found.hits.length === 0 ? (
              "No results"
            ) : (
              `${found.hits.length}${found.truncated ? "+" : ""} result${found.hits.length === 1 ? "" : "s"} in ${found.files} file${found.files === 1 ? "" : "s"}`
            )
          ) : null}
        </div>
      </div>
      {groups.map(([path, hits]) => {
        const rel = path.slice(root.length + 1);
        const name = rel.slice(rel.lastIndexOf("/") + 1);
        const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        const isClosed = closed.has(path);
        return (
          <div key={path}>
            <button
              onClick={() => setClosed((c) => (c.delete(path) ? new Set(c) : new Set(c).add(path)))}
              title={rel}
              className="flex h-[22px] w-full items-center gap-1 pl-1.5 pr-2 text-left text-[13px] text-text hover:bg-[#2a2d2e]"
            >
              <Icon name="chevron" className={["h-3.5 w-3.5 shrink-0 transition-transform", isClosed ? "" : "rotate-90"].join(" ")} />
              <span className="truncate">{name}</span>
              {dir && <span className="truncate text-[12px] text-muted">{dir}</span>}
              <span className="ml-auto shrink-0 rounded-full bg-white/[0.1] px-1.5 font-mono text-[10.5px] text-text">{hits.length}</span>
            </button>
            {!isClosed &&
              hits.map((h) => (
                <button
                  key={h.line}
                  onClick={() => onPick({ path, line: h.line, from: h.offset + (h.ranges[0]?.[0] ?? 0), to: h.offset + (h.ranges[0]?.[1] ?? 0) })}
                  title={`Line ${h.line}`}
                  className="flex h-[22px] w-full items-center pl-7 pr-2 text-left text-[12.5px] text-text hover:bg-[#2a2d2e]"
                >
                  <span className="truncate whitespace-pre">{highlight(h)}</span>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** The line with its matches marked, as VS Code marks search matches. Leading space is
 *  dropped: the indentation says nothing in a result list. */
function highlight(h: Hit): React.ReactNode {
  const lead = h.text.length - h.text.trimStart().length;
  const parts: React.ReactNode[] = [];
  let at = lead;
  for (const [a, b] of h.ranges) {
    if (b <= at) continue;
    const from = Math.max(a, at);
    parts.push(h.text.slice(at, from));
    parts.push(
      <mark key={a} className="rounded-[2px] bg-[#ea5c00]/40 text-white">
        {h.text.slice(from, b)}
      </mark>,
    );
    at = b;
  }
  parts.push(h.text.slice(at));
  return parts;
}
