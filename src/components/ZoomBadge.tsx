import { ZOOMED_TITLE } from "../lib/zoomPane";
import { Icon } from "./Icons";

/** On a zoomed block's header: the tab's other blocks are hidden. */
export function ZoomBadge() {
  return (
    <span title={ZOOMED_TITLE} className="flex shrink-0 items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-muted">
      <Icon name="maximize" className="h-3 w-3" />
      zoomed
    </span>
  );
}
