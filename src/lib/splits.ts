import type { Split } from "../types";

// The split tree of a terminal tab. Each function returns a new tree; none changes its input.

export const leaf = (): Split => ({ kind: "term", id: crypto.randomUUID() });

/** The shells, in reading order (left to right, top to bottom). */
export function leaves(s: Split): string[] {
  return s.kind === "term" ? [s.id] : s.parts.flatMap(leaves);
}

/** A new shell beside `id`: to its right ("row") or under it ("col"). In a split of the same
 *  direction it joins as a sibling and takes half of `id`'s share, as iTerm does. */
export function splitAt(s: Split, id: string, dir: "row" | "col", fresh: Split): Split {
  if (s.kind === "term") {
    return s.id === id ? { kind: "split", dir, parts: [s, fresh], sizes: [0.5, 0.5] } : s;
  }
  const i = s.parts.findIndex((p) => p.kind === "term" && p.id === id);
  if (i >= 0 && s.dir === dir) {
    const half = s.sizes[i] / 2;
    return {
      ...s,
      parts: [...s.parts.slice(0, i + 1), fresh, ...s.parts.slice(i + 1)],
      sizes: [...s.sizes.slice(0, i), half, half, ...s.sizes.slice(i + 1)],
    };
  }
  return { ...s, parts: s.parts.map((p) => splitAt(p, id, dir, fresh)) };
}

/** The tree without `id`; null when it was the last shell. Its share goes to its siblings,
 *  and a split left with one part becomes that part. */
export function remove(s: Split, id: string): Split | null {
  if (s.kind === "term") return s.id === id ? null : s;
  const parts: Split[] = [];
  const sizes: number[] = [];
  s.parts.forEach((p, i) => {
    const q = remove(p, id);
    if (q) {
      parts.push(q);
      sizes.push(s.sizes[i]);
    }
  });
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  const sum = sizes.reduce((a, b) => a + b, 0);
  return { ...s, parts, sizes: sizes.map((x) => x / sum) };
}

/** New sizes for the split at `path` (part indexes from the root). */
export function resize(s: Split, path: number[], sizes: number[]): Split {
  if (s.kind === "term") return s;
  if (path.length === 0) return { ...s, sizes };
  const [i, ...rest] = path;
  return { ...s, parts: s.parts.map((p, j) => (j === i ? resize(p, rest, sizes) : p)) };
}

/** Where a pane touches the window: its bottom corners then follow the window's curve. */
export interface Edges {
  bottom: boolean;
  left: boolean;
  right: boolean;
}

/** A rectangle as shares (0..1) of the whole tab. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Laid {
  panes: { id: string; box: Box; edges: Edges }[];
  /** The line between parts i and i+1 of the split at `path`, whose box is `box`. */
  dividers: { path: number[]; i: number; dir: "row" | "col"; at: number; box: Box; sizes: number[] }[];
}

/** Each pane's box in the tab, and each divider. The panes are flat (keyed by id), so a split
 *  or a close never moves a pane in the React tree: its shell keeps running. */
export function layout(s: Split, box: Box = { x: 0, y: 0, w: 1, h: 1 }, path: number[] = [], edges: Edges = { bottom: true, left: true, right: true }, out: Laid = { panes: [], dividers: [] }): Laid {
  if (s.kind === "term") {
    out.panes.push({ id: s.id, box, edges });
    return out;
  }
  const row = s.dir === "row";
  const last = s.parts.length - 1;
  let offset = 0;
  s.parts.forEach((p, i) => {
    const size = s.sizes[i];
    const child = row
      ? { x: box.x + offset * box.w, y: box.y, w: size * box.w, h: box.h }
      : { x: box.x, y: box.y + offset * box.h, w: box.w, h: size * box.h };
    layout(p, child, [...path, i], {
      bottom: edges.bottom && (row || i === last),
      left: edges.left && (!row || i === 0),
      right: edges.right && (!row || i === last),
    }, out);
    offset += size;
    if (i < last) out.dividers.push({ path, i, dir: s.dir, at: offset, box, sizes: s.sizes });
  });
  return out;
}
