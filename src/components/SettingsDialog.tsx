import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DEFAULTS, loadSettings, saveSetting, type Settings } from "../lib/settings";
import { Icon, type IconName } from "./Icons";

type Change = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

/** A page of the Settings window. A new page is one more entry here. */
const SECTIONS: { id: string; title: string; icon: IconName; render: (s: Settings, set: Change) => ReactNode }[] = [
  {
    id: "terminal",
    title: "Terminal",
    icon: "terminal",
    render: (s, set) => (
      <Row
        title="New terminal folder"
        description="Where a new terminal tab or split starts. The home folder when this folder does not exist."
        changed={!!s.termDir.trim() && s.termDir !== DEFAULTS.termDir}
        onReset={() => set("termDir", DEFAULTS.termDir)}
      >
        <FolderInput value={s.termDir} placeholder={DEFAULTS.termDir} onChange={(v) => set("termDir", v)} />
      </Row>
    ),
  },
];

/** The app's settings, in sections as in VS Code. A change saves at once. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(loadSettings);
  const [section, setSection] = useState(SECTIONS[0].id);
  const page = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  const set: Change = (key, value) => {
    setSettings((s) => ({ ...s, [key]: value }));
    saveSetting(key, value);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="m-auto flex h-[480px] w-full max-w-3xl overflow-hidden rounded-xl bg-panel shadow-float ring-[0.8px] ring-inset ring-white/[0.26]"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-white/[0.12] bg-white/[0.02] p-2">
          <h3 className="px-2 pb-2 pt-1.5 text-sm font-semibold tracking-tight">Settings</h3>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={s.id === page.id ? "page" : undefined}
              className={[
                "flex h-[28px] items-center gap-2 rounded-[4px] px-2 text-left text-[13px]",
                s.id === page.id ? "bg-white/[0.09] text-fg" : "text-muted hover:bg-hover hover:text-fg",
              ].join(" ")}
            >
              <Icon name={s.icon} className="h-4 w-4" />
              {s.title}
            </button>
          ))}
        </nav>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-white/[0.12] px-6 py-3">
            <h4 className="text-[15px] font-semibold tracking-tight">{page.title}</h4>
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-card hover:text-fg" aria-label="close" title="Close  Esc">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 divide-y divide-white/[0.08] overflow-y-auto px-6">{page.render(settings, set)}</div>
        </section>
      </div>
    </div>
  );
}

/** One setting: its name and what it does on the left, its control below; Reset when changed. */
function Row({ title, description, changed, onReset, children }: { title: string; description: string; changed: boolean; onReset: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-text">{title}</span>
        {changed && (
          <button onClick={onReset} className="ml-auto text-[12px] text-muted hover:text-fg" title="Back to the default">
            Reset
          </button>
        )}
      </div>
      <p className="text-[12px] leading-[17px] text-muted">{description}</p>
      {children}
    </div>
  );
}

const field = "h-[28px] w-full rounded-[4px] border border-[#3c3c3c] bg-[#313131] px-2 text-[13px] text-text placeholder:text-[#989898] focus:border-[#0078d4] focus:outline-none";

function FolderInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const pick = async () => {
    const dir = await open({ directory: true, defaultPath: value.startsWith("~") ? undefined : value });
    if (typeof dir === "string") onChange(dir);
  };
  return (
    <div className="flex max-w-md gap-2">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} className={`${field} font-mono`} />
      <button onClick={pick} className="h-[28px] shrink-0 rounded-[4px] bg-[#313131] px-3 text-[13px] text-text hover:bg-[#3c3c3c]">
        Browse…
      </button>
    </div>
  );
}
