// Which terminals have a claude at work, from the title claude sets: "◐ <task>" while it works
// (a half circle; braille spinners in some versions), "✳ <task>" while it waits for you. Every terminal reports its title here
// (TermView), hidden tabs too.

import { useSyncExternalStore } from "react";

const busy = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: string[] = [];

function changed() {
  snapshot = [...busy];
  listeners.forEach((l) => l());
}

export function reportTitle(ptyId: string, title: string) {
  const working = /^[\u25d0-\u25d3\u25f4-\u25f7\u2800-\u28ff]/.test(title.trim());
  if (working === busy.has(ptyId)) return;
  if (working) busy.add(ptyId);
  else busy.delete(ptyId);
  changed();
}

/** The terminal is gone (closed, or its tab closed). */
export function forget(ptyId: string) {
  if (busy.delete(ptyId)) changed();
}

/** The PTY ids where claude works now. */
export function useBusyClaudes(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
