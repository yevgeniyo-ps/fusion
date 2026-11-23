import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Wider still, for dense content like the release log. */
  xwide?: boolean;
  /** When true, the modal can't be dismissed via Escape, backdrop click, or ✕ — use for gates the user must complete. */
  blocking?: boolean;
}

export function Modal({ open, onClose, title, children, footer, wide, xwide, blocking }: Props) {
  useEffect(() => {
    if (!open || blocking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, blocking]);

  if (!open) return null;

  return (
    // Taller than the window: the backdrop scrolls (the dialog isn't clipped, so its menus aren't
    // either); it fits: centred, as before (m-auto).
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-black/60 p-4 backdrop-blur-sm"
      onClick={blocking ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={[
          "m-auto w-full rounded-xl bg-panel shadow-float ring-[0.8px] ring-inset ring-white/[0.26]",
          xwide ? "max-w-5xl" : wide ? "max-w-2xl" : "max-w-lg",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/[0.26] px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {!blocking && (
            <button
              onClick={onClose}
              className="rounded-md px-2 py-1 text-muted hover:bg-card hover:text-fg"
              aria-label="close"
            >
              ✕
            </button>
          )}
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-white/[0.26] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
