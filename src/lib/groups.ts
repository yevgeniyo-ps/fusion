import type { ProjectGroup } from "../types";

// Project groups in the sidebar, as Chrome's tab groups: a name, a colour, folded or open.
// Chrome's group colours (dark theme), in Chrome's order.
export const GROUP_COLORS = [
  { name: "Grey", value: "#bdc1c6" },
  { name: "Blue", value: "#8ab4f8" },
  { name: "Red", value: "#f28b82" },
  { name: "Yellow", value: "#fdd663" },
  { name: "Green", value: "#81c995" },
  { name: "Pink", value: "#ff8bcb" },
  { name: "Purple", value: "#c58af9" },
  { name: "Cyan", value: "#78d9ec" },
  { name: "Orange", value: "#fcad70" },
];

/** The first colour no group has yet; after all nine, they repeat. */
export function nextGroupColor(groups: ProjectGroup[]): string {
  const used = new Set(groups.map((g) => g.color));
  return (GROUP_COLORS.find((c) => !used.has(c.value)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length]).value;
}

/** The groups with `paths` moved into group `to` (or out of every group, for null). A
 *  project is in one group at most. */
export function moveTo(groups: ProjectGroup[], paths: string[], to: string | null): ProjectGroup[] {
  const moving = new Set(paths);
  return groups.map((g) => {
    const kept = g.paths.filter((p) => !moving.has(p));
    return g.id === to ? { ...g, paths: [...kept, ...paths] } : { ...g, paths: kept };
  });
}

/** `path` into group `to`, next to `target` (before it, or after it). */
export function insertNear(groups: ProjectGroup[], path: string, to: string, target: string, after: boolean): ProjectGroup[] {
  if (path === target) return groups;
  return groups.map((g) => {
    const kept = g.paths.filter((p) => p !== path);
    if (g.id !== to) return { ...g, paths: kept };
    const i = kept.indexOf(target);
    const at = i < 0 ? kept.length : i + (after ? 1 : 0);
    return { ...g, paths: [...kept.slice(0, at), path, ...kept.slice(at)] };
  });
}

/** The group's projects A to Z, by the names the sidebar shows. */
export function sortGroup(groups: ProjectGroup[], id: string, nameOf: (path: string) => string): ProjectGroup[] {
  return groups.map((g) => (g.id === id ? { ...g, paths: [...g.paths].sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" })) } : g));
}

/** Group `id` moved next to group `target`: before it, or after it. */
export function moveGroup(groups: ProjectGroup[], id: string, target: string, after: boolean): ProjectGroup[] {
  if (id === target) return groups;
  const moving = groups.find((g) => g.id === id);
  if (!moving) return groups;
  const rest = groups.filter((g) => g.id !== id);
  const i = rest.findIndex((g) => g.id === target);
  const at = i < 0 ? rest.length : i + (after ? 1 : 0);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** The groups A to Z by name; unnamed ones last, in the order they had. */
export function sortGroups(groups: ProjectGroup[]): ProjectGroup[] {
  const named = groups.filter((g) => g.name.trim()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return [...named, ...groups.filter((g) => !g.name.trim())];
}
