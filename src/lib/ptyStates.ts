import { api } from "../api";

type States = Record<string, { cwd: string | null; command: string | null }>;
let shared: { at: number; states: Promise<States> } | null = null;

/** What each shell runs, read once for all terminals and for session restore (App):
 *  pty_states runs `ps` over every process. A read under 2.5 s old is used again. */
export function states(): Promise<States> {
  if (!shared || Date.now() - shared.at > 2500) {
    shared = { at: Date.now(), states: api.ptyStates().catch(() => ({})) };
  }
  return shared.states;
}
