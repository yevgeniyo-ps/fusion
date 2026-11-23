import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { api } from "../api";
import type { PtyEvent } from "../types";
import { MONO, XTERM_THEME } from "../lib/theme";
import { fontKey, loadFont, saveFont } from "../lib/fontSize";
import { takeRestore } from "../lib/restore";

/** What a terminal's parent can do with it. */
export interface TermHandle {
  write: (data: string) => void;
  paste: (text: string) => void;
  focus: () => void;
}

interface Props {
  /** The PTY's id: the tab id for a project tab, the pane id in a terminal tab. */
  ptyId: string;
  /** A plain shell in the home folder (terminal tab) instead of the tab folder. */
  plain: boolean;
  /** False until the shell can start (a project tab waits for its tab folder). */
  ready: boolean;
  /** Where a plain shell starts; the home folder when unset. */
  cwd?: string;
  /** Fit and focus when this becomes true (the tab opens, the pane is picked). */
  focused: boolean;
  onHandle?: (h: TermHandle | null) => void;
  /** The title the shell or the program sets (OSC 0/2), as iTerm shows it. */
  onTitle?: (title: string) => void;
  onFocus?: () => void;
}

/** One xterm and its shell. */
export function TermView({ ptyId, plain, ready, cwd, focused, onHandle, onTitle, onFocus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  // A new shell after the old one exits: Enter bumps it.
  const [generation, setGeneration] = useState(0);
  // The latest callbacks, without starting the shell again when they change.
  const cb = useRef({ onHandle, onTitle, onFocus });
  cb.current = { onHandle, onTitle, onFocus };

  useEffect(() => {
    if (!ready || !host.current) return;
    const t = new XTerm({
      // VS Code's terminal defaults on macOS.
      fontFamily: MONO,
      fontSize: loadFont(`term.${ptyId}`),
      lineHeight: 1.2,
      fontWeight: "normal",
      fontWeightBold: "bold",
      drawBoldTextInBrightColors: true,
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: 10000,
      theme: XTERM_THEME,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      t.loadAddon(gl);
    } catch {
      // No WebGL: xterm's DOM renderer draws instead.
    }
    if (host.current.offsetWidth > 0) f.fit();

    let live = true;
    let exited = false;
    const events = new Channel<PtyEvent>();
    events.onmessage = (e) => {
      if (!live) return;
      if (e.kind === "data") {
        t.write(e.data);
      } else {
        exited = true;
        t.write("\r\n\x1b[2m[the shell exited: press Enter for a new one]\x1b[0m\r\n");
      }
    };
    // After a restart: the folder it was in, and the command it ran (watch, claude, …).
    const restore = takeRestore(ptyId);
    if (restore?.command) t.write(`\x1b[2mfusion: restoring ${restore.command}\x1b[0m\r\n`);
    api.ptySpawn(ptyId, t.cols, t.rows, plain, restore?.cwd ?? cwd ?? null, restore?.command ?? null, events).catch((e) => t.write(`\x1b[31m${e}\x1b[0m\r\n`));
    const input = t.onData((d) => {
      if (exited) {
        if (d === "\r") setGeneration((g) => g + 1);
        return;
      }
      api.ptyWrite(ptyId, d).catch(() => {});
    });
    const resize = t.onResize(({ cols, rows }) => api.ptyResize(ptyId, cols, rows).catch(() => {}));
    const title = t.onTitleChange((s) => cb.current.onTitle?.(s));
    // xterm keeps its textarea for keys: its focus is the pane's.
    const textarea = t.textarea;
    const focusIn = () => cb.current.onFocus?.();
    textarea?.addEventListener("focus", focusIn);
    // ⌘+ / ⌘- / ⌘0 here: this terminal's font only. The rows and columns fit again.
    const zoom = (e: KeyboardEvent) => {
      const size = fontKey(e, t.options.fontSize ?? 12);
      if (size === null) return;
      e.preventDefault();
      e.stopPropagation();
      t.options.fontSize = size;
      saveFont(`term.${ptyId}`, size);
      f.fit();
    };
    const box = host.current;
    box.addEventListener("keydown", zoom, true);
    const observer = new ResizeObserver(() => {
      if (host.current && host.current.offsetWidth > 0) f.fit();
    });
    observer.observe(host.current);
    term.current = t;
    fit.current = f;
    cb.current.onHandle?.({
      write: (d) => t.write(d),
      paste: (s) => t.paste(s),
      focus: () => t.focus(),
    });
    return () => {
      live = false;
      cb.current.onHandle?.(null);
      observer.disconnect();
      box.removeEventListener("keydown", zoom, true);
      textarea?.removeEventListener("focus", focusIn);
      title.dispose();
      input.dispose();
      resize.dispose();
      t.dispose();
    };
  }, [ready, ptyId, plain, generation]);

  useEffect(() => {
    if (!focused) return;
    requestAnimationFrame(() => {
      fit.current?.fit();
      term.current?.focus();
    });
  }, [focused]);

  return <div ref={host} className="min-h-0 flex-1 select-text" />;
}
