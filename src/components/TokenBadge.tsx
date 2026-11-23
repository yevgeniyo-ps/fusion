import { dollars, tokens, type Usage } from "../lib/usage";

/** The Claude tokens of a terminal's session, in its header: what went in (new input, cache
 *  reads and cache writes: most of it is cache) and what came out. */
export function TokenBadge({ usage, running }: { usage: Usage | null; running: boolean }) {
  // Only while claude runs in the terminal: after it exits, the count is gone with it. (A
  // project tab's claude resumes its session when it starts again, and the count goes on.)
  if (!running) return null;
  if (!usage || usage.replies === 0) {
    // Claude runs, but its session has no reply yet (Claude Code writes the transcript then).
    return (
      <span title="Claude runs here; the count starts with its first reply" className="flex shrink-0 items-center gap-1.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-faint">
        <span className="text-[#d97757]">✻</span>
        no tokens yet
      </span>
    );
  }
  const into = usage.input + usage.cache_read + usage.cache_write;
  const priced = usage.replies > usage.unpriced;
  const title = [
    priced ? `≈ ${dollars(usage.cost)} at Claude API list prices: an estimate, not a bill (a Claude plan is not billed per token)` : "",
    usage.unpriced ? `${usage.unpriced} replies from a model without a price here: not in the estimate` : "",
    `${usage.replies} replies${usage.model ? ` · ${usage.model}` : ""}`,
    `input ${usage.input.toLocaleString()}`,
    `cache read ${usage.cache_read.toLocaleString()}`,
    `cache write ${usage.cache_write.toLocaleString()}`,
    `output ${usage.output.toLocaleString()}`,
  ].filter(Boolean).join("\n");
  return (
    <span title={title} className="flex shrink-0 items-center gap-1.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-muted">
      <span className="text-[#d97757]">✻</span>
      {tokens(into)} in
      <span className="text-faint">·</span>
      {tokens(usage.output)} out
      {priced && (
        <>
          <span className="text-faint">·</span>
          <span className="text-text">≈{dollars(usage.cost)}</span>
        </>
      )}
    </span>
  );
}
