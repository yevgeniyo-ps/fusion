import type { Project, Tab } from "../types";

/** The last part of a path. */
export const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** A path with the home folder as ~. */
export function tildify(p: string, home: string | null): string {
  return home && p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

/** "api + ui + infra", or the name the user gave the tab. */
export function tabName(tab: Tab, byPath: Map<string, Project>): string {
  if (tab.name) return tab.name;
  if (tab.kind === "terminal") return "Terminal";
  // A text tab: its first line, without Markdown's heading or list mark.
  if (tab.kind === "note") return tab.text?.split("\n").find((l) => l.trim())?.trim().replace(/^(#{1,6}|[-*>])\s+/, "").slice(0, 40) || "Untitled";
  if (tab.projects.length === 0) return "Empty";
  return tab.projects.map((p) => byPath.get(p)?.name ?? baseName(p)).join(" + ");
}
