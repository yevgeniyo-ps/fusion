import type { ITheme } from "@xterm/xterm";

// The design tokens (tailwind.config.js), for the two parts Tailwind cannot style.
// The fonts and the terminal colours are VS Code's defaults on macOS.
export const MONO = 'Menlo, Monaco, "SF Mono", monospace';

export const C = {
  panel: "#0a0a0c",
  fg: "#e8eaed",
  muted: "#9d9d9d",
  faint: "#6e7681",
  text: "#d4d4d4",
  todo: "#a3a8b4",
  progress: "#f4a93a",
  done: "#6cd17b",
};

export const XTERM_THEME: ITheme = {
  // The WebGL renderer needs an opaque colour: the pane's own.
  background: C.panel,
  // Near white: VS Code's #cccccc reads grey on black.
  foreground: "#ececec",
  cursor: "#ffffff",
  cursorAccent: C.panel,
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#f0f0f0",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};
