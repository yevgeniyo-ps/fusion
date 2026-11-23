import { TermView } from "./TermView";
import { Icon } from "./Icons";
import type { Project } from "../types";
import { projectTermId } from "../lib/projectTerm";
import { TokenBadge } from "./TokenBadge";
import { useClaudeUsage } from "../lib/usage";

/** A terminal for one project: a plain shell in its folder. It shows under the project while
 *  the project is zoomed, and keeps running (hidden) when it is not. */
export function ProjectTerminal({ tabId, project, shown }: { tabId: string; project: Project; shown: boolean }) {
  const id = projectTermId(tabId, project.path);
  const { usage, running: claudeRuns } = useClaudeUsage(id, true, shown);
  return (
    <section className={["flex h-full min-h-0 flex-col overflow-hidden rounded-md tab-edge rounded-b-[calc(var(--window-radius)-var(--frame-gap))] bg-panel", shown ? "" : "hidden"].join(" ")}>
      <header className="flex h-9 shrink-0 items-center gap-2.5 border-b border-[#2b2b2b] px-3">
        <Icon name="terminal" className="h-3.5 w-3.5 text-muted" />
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[12px] text-muted">{project.name}</span>
        <TokenBadge usage={usage} running={claudeRuns} />
      </header>
      <TermView ptyId={projectTermId(tabId, project.path)} plain ready cwd={project.path} focused={shown} />
    </section>
  );
}
