// App settings the user sets in the Settings window. One JSON object in localStorage; a new
// setting is a field here and a default. Each change saves at once.

export interface Settings {
  /** Where a terminal tab's new shell starts (`~/` allowed). */
  termDir: string;
}

export const DEFAULTS: Settings = {
  termDir: "~/code",
};

const KEY = "fusion.settings";

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Settings>;
    // The folder was a key of its own before the Settings window had sections.
    const termDir = localStorage.getItem("fusion.term.dir");
    return { ...DEFAULTS, ...(termDir ? { termDir } : {}), ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Saves one setting; its default (or an empty value) is not stored. */
export function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  try {
    const s = loadSettings();
    s[key] = typeof value === "string" && !value.trim() ? DEFAULTS[key] : value;
    const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== DEFAULTS[k as keyof Settings]));
    localStorage.setItem(KEY, JSON.stringify(changed));
    localStorage.removeItem("fusion.term.dir");
  } catch {
    /* private storage: the setting is just not remembered */
  }
}

export const loadTermDir = () => loadSettings().termDir;
