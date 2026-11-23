import { useLayoutEffect, useRef } from "react";

/** A double-click anywhere in a block zooms it, but not on its buttons or inputs. */
export function blockDoubleClick(onZoom: () => void) {
  return (e: React.MouseEvent) => {
    // Not on a control, and not on a terminal's name (a double-click there renames it).
    if ((e.target as HTMLElement).closest("button, input, a, label, select, [data-rename]")) return;
    onZoom();
  };
}

/** The badge a zoomed block shows: other blocks of the tab are hidden. */
export const ZOOMED_TITLE = "Zoomed: the other blocks are hidden. Double-click the block to bring them back.";

const ZOOM_MS = 420;
const APPEAR_MS = 320;
// A spring: it runs a little past the end, then settles back.
const SPRING = "cubic-bezier(0.34, 1.3, 0.64, 1)";
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** The block's edge at rest (.tab-edge in index.css), and lit up while it moves. */
const EDGE = "0 0 0 1.5px rgba(255, 255, 255, 0.6)";
const GLOW = "0 0 0 1.5px rgba(255, 255, 255, 0.95), 0 0 40px rgba(255, 255, 255, 0.16)";
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The zoom's motion (FLIP): when `zoomed` changes, the block moves and scales from where it
 *  was to where it is now, on a spring, so it grows to fill the tab and shrinks back into its
 *  place. Its edge lights up on the way, and a slight blur hides the stretched content.
 *  When `hidden` turns false (another block zoomed out), the block fades and scales in, the
 *  blocks nearer the top left first. */
export function useZoomMotion<T extends HTMLElement>(zoomed: boolean, hidden: boolean) {
  const ref = useRef<T>(null);
  const last = useRef<DOMRect | null>(null);
  const was = useRef({ zoomed, hidden });

  // First: animate from the rect of the last layout. (Declared before the effect that
  // records the rect, so it still sees the old one.)
  useLayoutEffect(() => {
    const el = ref.current;
    const before = was.current;
    was.current = { zoomed, hidden };
    if (!el || reduced()) return;
    if (before.zoomed !== zoomed && last.current && !hidden) {
      const from = last.current;
      const to = el.getBoundingClientRect();
      if (from.width && from.height && to.width && to.height) {
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        const sx = from.width / to.width;
        const sy = from.height / to.height;
        el.animate(
          [
            { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, filter: "blur(1.5px)", boxShadow: EDGE },
            { offset: 0.55, filter: "blur(0.5px)", boxShadow: GLOW },
            { transformOrigin: "top left", transform: "none", filter: "none", boxShadow: EDGE },
          ],
          { duration: ZOOM_MS, easing: SPRING },
        );
      }
    } else if (before.hidden && !hidden) {
      // Nearer the top left, sooner: the blocks come back one after another.
      const r = el.getBoundingClientRect();
      const delay = Math.round(((r.left / window.innerWidth + r.top / window.innerHeight) / 2) * 140);
      el.animate(
        [
          { opacity: 0, transform: "scale(0.9)", filter: "blur(4px)" },
          { opacity: 1, transform: "none", filter: "none" },
        ],
        { duration: APPEAR_MS, delay, easing: EASE, fill: "backwards" },
      );
    }
  }, [zoomed, hidden]);

  // Then: remember where the block is now, and again whenever it resizes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const record = () => {
      if (el.offsetWidth > 0) last.current = el.getBoundingClientRect();
    };
    record();
    const ro = new ResizeObserver(record);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return ref;
}
