import { useEffect, useRef, useState } from "react";
import { useBusyClaudes } from "../lib/claudeActivity";
import { SCENE, drawFinished, drawThinking } from "../lib/activityScene";

export interface TabRef {
  id: string;
  name: string;
}

export interface ClaudeTabs {
  /** Tabs where claude thinks now. */
  working: TabRef[];
  /** Tabs where claude finished, not opened since. */
  done: TabRef[];
  dismiss: () => void;
}

/** Which tabs have claude thinking, and which finished and were not seen yet. Opening a tab
 *  is seeing it; the finished ones also go away 30 s after the last one finished. */
export function useClaudeTabs(tabOf: (ptyId: string) => TabRef | null, active: string | null): ClaudeTabs {
  const busyIds = useBusyClaudes();
  const tabOfRef = useRef(tabOf);
  tabOfRef.current = tabOf;
  const prev = useRef<string[]>([]);
  const [done, setDone] = useState<TabRef[]>([]);

  const unique = (refs: (TabRef | null)[]) => refs.filter((t, i, a): t is TabRef => !!t && a.findIndex((x) => x?.id === t.id) === i);
  const working = unique(busyIds.map((id) => tabOf(id)));

  useEffect(() => {
    const now = new Set(busyIds);
    const ended = unique(prev.current.filter((id) => !now.has(id)).map((id) => tabOfRef.current(id)));
    const started = new Set(busyIds.map((id) => tabOfRef.current(id)?.id));
    prev.current = busyIds;
    setDone((d) => {
      const kept = d.filter((t) => !started.has(t.id));
      const fresh = ended.filter((t) => !started.has(t.id) && !kept.some((k) => k.id === t.id));
      return fresh.length || kept.length !== d.length ? [...kept, ...fresh] : d;
    });
  }, [busyIds]);

  useEffect(() => {
    if (active) setDone((d) => (d.some((t) => t.id === active) ? d.filter((t) => t.id !== active) : d));
  }, [active]);

  useEffect(() => {
    if (done.length === 0) return;
    const t = setTimeout(() => setDone([]), 30_000);
    return () => clearTimeout(t);
  }, [done]);

  return { working, done, dismiss: () => setDone([]) };
}

/** In the tab bar, beside the tabs: a small animation while claude thinks in some tab (with
 *  how many when more than one), the finished one when nothing thinks and a tab finished.
 *  A click goes to that tab. It never covers the blocks. */
export function ActivityBadge({ tabs, onPick }: { tabs: ClaudeTabs; onPick: (tabId: string) => void }) {
  const { working, done } = tabs;
  if (working.length === 0 && done.length === 0) return null;
  const kind = working.length > 0 ? "thinking" : "finished";
  const list = kind === "thinking" ? working : done;
  const names = list.map((t) => t.name).join(", ");
  return (
    <button
      onClick={() => onPick(list[0].id)}
      title={kind === "thinking" ? `Brewing: ${names}` : `Finished: ${names}`}
      className="activity-in relative flex h-9 w-9 shrink-0 items-center justify-center"
    >
      <Scene key={kind} kind={kind} size={44} />
      {list.length > 1 && (
        <span className="absolute -right-1 bottom-0 rounded-full bg-black px-1 font-mono text-[10px] leading-[14px] text-white/80 ring-1 ring-white/20">{list.length}</span>
      )}
    </button>
  );
}

/** The animation, on a canvas with no box around it. Its timeline starts when it appears.
 *  With reduced motion, one still frame. */
function Scene({ kind, size }: { kind: "thinking" | "finished"; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = kind === "thinking" ? drawThinking : drawFinished;
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const time = still ? (kind === "thinking" ? 1.3 : 3) : (now - start) / 1000;
      g.setTransform((dpr * size) / SCENE, 0, 0, (dpr * size) / SCENE, 0, 0);
      g.clearRect(0, 0, SCENE, SCENE);
      draw(g, time);
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [kind, size]);
  return (
    <canvas
      ref={canvas}
      aria-hidden
      style={{ width: size, height: size }}
      className={["pointer-events-none absolute shrink-0", kind === "thinking" ? "activity-glow" : "activity-glow-done"].join(" ")}
    />
  );
}
