import { createContext, useContext, useState } from "react";
import { Icon } from "./Icons";

/** The names the user gave terminals, by PTY id (saved in the layout), and how to change one. */
export const SessionNames = createContext<{ names: Record<string, string>; rename: (id: string, name: string) => void }>({
  names: {},
  rename: () => {},
});

/** A terminal's name in its header. Double-click it (or the ✎) to rename; Enter keeps the
 *  name, Esc drops the edit, an empty name brings the default back. `data-rename` keeps a
 *  double-click here from zooming the block (zoomPane.ts). */
export function SessionName({ id, fallback, className }: { id: string; fallback: string; className: string }) {
  const { names, rename } = useContext(SessionNames);
  const [editing, setEditing] = useState(false);
  const name = names[id];

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={name ?? ""}
        placeholder={fallback}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          rename(id, e.currentTarget.value.trim());
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="h-[22px] w-44 min-w-0 rounded-[4px] border border-[#0078d4] bg-[#313131] px-1.5 text-[12px] text-text outline-none placeholder:text-[#989898]"
      />
    );
  }
  return (
    <span data-rename className="group/name flex min-w-0 items-center gap-1">
      <span onDoubleClick={() => setEditing(true)} title="Double-click to rename" className={["min-w-0 truncate", className].join(" ")}>
        {name || fallback}
      </span>
      {/* The press must not reach the pane: focusing it would move the keyboard to its terminal. */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setEditing(true)}
        title="Rename"
        className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:bg-hover hover:text-fg group-hover/name:opacity-100"
      >
        <Icon name="pencil" className="h-3 w-3" />
      </button>
    </span>
  );
}
