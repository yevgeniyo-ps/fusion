// ⌘+ / ⌘- / ⌘0 in one terminal or editor: its font size only, as iTerm does per session.
// Each pane keeps its size (localStorage, by a key the pane gives).

export const DEFAULT_FONT = 12;
const MIN = 8;
const MAX = 32;

/** The next size for a zoom key, or null when the key is not one. */
export function fontKey(e: KeyboardEvent, size: number): number | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.code === "Equal" || e.code === "NumpadAdd") return Math.min(MAX, size + 1);
  if (e.code === "Minus" || e.code === "NumpadSubtract") return Math.max(MIN, size - 1);
  if (e.code === "Digit0" || e.code === "Numpad0") return DEFAULT_FONT;
  return null;
}

export function loadFont(key: string): number {
  try {
    const n = Number(localStorage.getItem(`fusion.font.${key}`));
    return n >= MIN && n <= MAX ? n : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

export function saveFont(key: string, size: number) {
  try {
    if (size === DEFAULT_FONT) localStorage.removeItem(`fusion.font.${key}`);
    else localStorage.setItem(`fusion.font.${key}`, String(size));
  } catch {
    /* private storage: the size is just not remembered */
  }
}
