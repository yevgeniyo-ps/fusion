import { useEffect, useState } from "react";
import { api, type PlanLimit, type PlanUsage as Usage } from "../api";
import { Icon } from "./Icons";

const EVERY = 2 * 60 * 1000;

/** The Claude plan's weekly limit, as Claude Code's /usage shows it, in percent used (the
 *  longest limit: the plan has no monthly one). Read every 2 minutes and when the window comes back. Hidden when
 *  they cannot be read (no Claude Code login, offline). */
export function PlanUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let gone = false;
    const read = () => api.planUsage().then((u) => !gone && u && setUsage(u)).catch(() => {});
    read();
    const timer = setInterval(read, EVERY);
    window.addEventListener("focus", read);
    return () => {
      gone = true;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, []);
  if (!usage) return null;
  return (
    <div className="flex items-center gap-3">
      {/* Under the gear, in the same 22px column. */}
      <span className="flex w-[22px] shrink-0 justify-center" title="Claude plan usage">
        <Icon name="spark" className="h-3.5 w-3.5 text-[#d97757]" />
      </span>
      <Meter label="Week" what="Weekly limit" limit={usage.seven_day} />
    </div>
  );
}

/** 14:05 today, else "Sat 18:00". */
function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function Meter({ label, what, limit }: { label: string; what: string; limit: PlanLimit | null }) {
  if (!limit) return null;
  const pct = Math.max(0, Math.min(100, Math.round(limit.utilization)));
  const fill = pct >= 95 ? "from-[#f14c4c]/70 to-[#f14c4c]" : pct >= 80 ? "from-status-progress/70 to-status-progress" : "from-white/45 to-white/85";
  const title = `${what}: ${pct}% used${limit.resets_at ? ` · resets ${when(limit.resets_at)}` : ""}`;
  return (
    <div title={title} className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 text-[11px] font-medium text-muted">{label}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
        {/* At least a dot, so 1% still shows. */}
        <div className={`h-full rounded-full bg-gradient-to-r ${fill}`} style={{ width: pct > 0 ? `max(6px, ${pct}%)` : 0 }} />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-text">{pct}%</span>
    </div>
  );
}
