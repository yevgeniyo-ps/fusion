import { useEffect, useState } from "react";
import { api } from "../api";

export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  replies: number;
  model: string;
  /** What these tokens would cost on the Claude API at list prices, in US dollars. */
  cost: number;
  /** Replies whose model has no price in Fusion's table: counted in tokens, not in cost. */
  unpriced: number;
}

const EVERY = 4000;

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

/** The Claude tokens of a terminal's session (src-tauri/src/usage.rs), read again every few
 *  seconds while `on`. A project tab's terminal has its own session id, so its count is exact
 *  and stays across restarts. In a plain terminal, it is the claude that runs there: counted
 *  only once claude has run in it, so an old transcript of the same folder is not shown.
 *  `running` says whether claude runs in it now: the badge shows only then. */
export function useClaudeUsage(id: string, plain: boolean, on: boolean): { usage: Usage | null; running: boolean } {
  const [usage, setUsage] = useState<Usage | null>(null);
  // Claude runs in the terminal now: the badge shows before the first reply too.
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!on) return;
    let gone = false;
    let seen = false;
    const read = async () => {
      const st = (await states())[id];
      const now = st?.command?.split(" ")[0] === "claude";
      if (!gone) setRunning(now);
      let cwd: string | null = null;
      if (plain) {
        if (now) seen = true;
        if (!seen || !st?.cwd) return;
        cwd = st.cwd;
      }
      const u = await api.claudeUsage(id, plain, cwd).catch(() => null);
      if (!gone && u) setUsage(u);
    };
    read();
    const timer = setInterval(read, EVERY);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [id, plain, on]);
  return { usage, running };
}

/** $0.004 -> <$0.01, $4.123 -> $4.12, $123.4 -> $123. */
export function dollars(n: number): string {
  if (n < 0.01) return "<$0.01";
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

/** 1234 -> 1.2k, 1234567 -> 1.2M. */
export function tokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}
