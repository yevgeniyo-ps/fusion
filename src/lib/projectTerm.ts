/** The PTY id of a project's own terminal in a tab (opened when the project is zoomed):
 *  the same for the same tab and project, so session restore finds it after a restart. */
export function projectTermId(tabId: string, path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 0x01000193) >>> 0;
  return `${tabId}-p${h.toString(16)}`;
}
