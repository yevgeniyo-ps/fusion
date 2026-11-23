// Session restore. App saves what each shell runs (pty_states) into the layout every few
// seconds; a terminal that starts reads its entry once, for its folder and its command.

export interface ShellState {
  cwd?: string | null;
  command?: string | null;
}

let saved: Record<string, ShellState> = {};

export function setSaved(states: Record<string, ShellState>) {
  saved = states;
}

/** The entry for a shell that starts now. Used once: a shell started again later (Enter
 *  after it exits) starts in the same folder but does not run the command again. */
export function takeRestore(id: string): ShellState | undefined {
  const s = saved[id];
  if (s?.command) saved = { ...saved, [id]: { ...s, command: null } };
  return s;
}
