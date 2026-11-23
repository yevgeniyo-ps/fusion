/** The handle of a resizable gap: a short line, lying for a gap between top and bottom,
 *  standing for a gap between left and right. */
export function Grip({ vertical = false }: { vertical?: boolean }) {
  return (
    <span
      className={[
        "rounded-full bg-white/45 transition-colors group-hover:bg-white/90",
        vertical ? "h-12 w-[3px]" : "h-[3px] w-12",
      ].join(" ")}
    />
  );
}
