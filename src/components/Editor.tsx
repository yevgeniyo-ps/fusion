import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { Annotation, Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { goToNextChunk, goToPreviousChunk, unifiedMergeView } from "@codemirror/merge";
import { tags as t } from "@lezer/highlight";
import { api } from "../api";
import { onFsChange } from "../lib/fsEvents";
import { C, MONO } from "../lib/theme";
import { Icon } from "./Icons";
import { fontKey, loadFont, saveFont } from "../lib/fontSize";

// VS Code's diff colours: green for new and changed lines, red for deleted ones.
const ADDED = "rgba(46, 160, 67, 0.13)";
const ADDED_TEXT = "rgba(46, 160, 67, 0.35)";
const DELETED = "rgba(248, 81, 73, 0.12)";
const DELETED_TEXT = "rgba(248, 81, 73, 0.35)";

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "transparent", color: C.text },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: MONO, lineHeight: "1.5" },
    ".cm-content": { caretColor: "#ffffff" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffffff" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#858585", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#c6c6c6" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "#264f78" },
    ".cm-selectionMatch": { backgroundColor: "rgba(255,255,255,0.08)" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "rgba(255,255,255,0.12)", outline: "none" },
    ".cm-foldPlaceholder": { backgroundColor: "rgba(255,255,255,0.08)", border: "none", color: C.muted },
    ".cm-panels": { backgroundColor: C.panel, color: C.fg, borderColor: "rgba(255,255,255,0.12)" },
    ".cm-tooltip": { backgroundColor: "#101113", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "8px" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgba(255,255,255,0.12)", color: "#ffffff" },

    // Diff against HEAD (@codemirror/merge, unified view).
    ".cm-changedLine": { backgroundColor: `${ADDED} !important` },
    ".cm-changedText": { background: `${ADDED_TEXT} !important` },
    ".cm-deletedChunk": { backgroundColor: DELETED, position: "relative" },
    ".cm-deletedChunk .cm-deletedLine": { backgroundColor: "transparent" },
    ".cm-deletedChunk .cm-deletedText, .cm-deletedChunk del": { background: DELETED_TEXT, textDecoration: "none" },
    ".cm-changeGutter": { width: "3px", paddingLeft: "2px" },
    ".cm-changedLineGutter": { background: "#2ea043" },
    ".cm-deletedLineGutter": { background: "#f85149" },
    ".cm-chunkButtons": { position: "absolute", right: "8px", top: "2px", zIndex: "2" },
    ".cm-collapsedLines": { color: C.muted, background: "rgba(255,255,255,0.04)", fontFamily: MONO },
  },
  { dark: true },
);

// VS Code's Dark+ colours, so code reads the way it does there.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.definitionKeyword, t.modifier, t.self], color: "#569cd6" },
  { tag: [t.controlKeyword, t.operatorKeyword], color: "#c586c0" },
  { tag: [t.string, t.special(t.string)], color: "#ce9178" },
  { tag: t.regexp, color: "#d16969" },
  { tag: t.number, color: "#b5cea8" },
  { tag: [t.bool, t.null, t.atom], color: "#569cd6" },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: "#4fc1ff" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6a9955" },
  { tag: [t.typeName, t.className, t.namespace], color: "#4ec9b0" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#dcdcaa" },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: "#9cdcfe" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#d4d4d4" },
  { tag: t.tagName, color: "#569cd6" },
  { tag: t.heading, color: "#569cd6", fontWeight: "600" },
  { tag: t.link, color: "#3794ff", textDecoration: "underline" },
  { tag: t.invalid, color: "#f44747" },
]);

/** The font size, as VS Code's 12px with an 18px line at the default. */
const fontTheme = (size: number) => EditorView.theme({ "&": { fontSize: `${size}px` } });

/** A transaction that loads the file from disk: it does not make the editor dirty. */
const fromDisk = Annotation.define<boolean>();

/** Each deleted chunk gets one button: revert the chunk to HEAD. (No "accept": HEAD is the base.) */
function chunkButton(type: "reject" | "accept", action: (e: MouseEvent) => void): HTMLElement {
  if (type === "accept") return document.createElement("span");
  const b = document.createElement("button");
  b.textContent = "revert";
  b.title = "Undo this change: back to HEAD (⌘Z undoes the revert)";
  b.className = "rounded-md bg-black/60 px-1.5 py-[1px] font-sans text-[10.5px] text-muted ring-1 ring-inset ring-white/20 hover:text-fg";
  b.onmousedown = action;
  return b;
}

/** The smallest change from `a` to `b`: the cursor and scroll stay where they are. */
function minimalChange(a: string, b: string) {
  let from = 0;
  while (from < a.length && from < b.length && a[from] === b[from]) from++;
  let endA = a.length;
  let endB = b.length;
  while (endA > from && endB > from && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from, to: endA, insert: b.slice(from, endB) };
}

interface Props {
  path: string | null;
  /** Show the changes against HEAD. */
  diff: boolean;
  /** The HEAD commit: when it moves (a commit, a checkout), the diff base loads again. */
  head: string;
  onDirty: (dirty: boolean) => void;
  /** The lines of the cursor or the selection, 1-based. */
  onLines?: (from: number, to: number) => void;
  /** Where this editor keeps its font size (⌘+ / ⌘-): the pane's project. */
  fontId: string;
  /** A search result to show: its line, scrolled to the middle, the match selected. */
  jump?: { path: string; line: number; from: number; to: number; n: number } | null;
  /** Open (or copy the link to) lines from..to on GitHub; unset outside a git repo. */
  onGithub?: (copy: boolean, from: number, to: number) => void;
}

/** Autosave: this long after the last change (VS Code's "afterDelay"). */
const AUTOSAVE_MS = 1000;

/** One file at a time. It saves itself AUTOSAVE_MS after a change and when it loses focus;
 *  ⌘S saves at once. When the file changes on disk (claude, git), the editor shows the new
 *  text, and the diff shows what moved. */
export function Editor({ path, diff, head, onDirty, onLines, fontId, jump, onGithub }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const open = useRef<string | null>(null);
  const dirty = useRef(false);
  const diffSlot = useRef(new Compartment());
  const fontSlot = useRef(new Compartment());
  const font = useRef(loadFont(`editor.${fontId}`));
  const [error, setError] = useState<string | null>(null);
  // The file changed on disk while it had unsaved edits here.
  const [conflict, setConflict] = useState(false);
  const [base, setBase] = useState<string | null>(null);
  // Counts file loads: each one replaces the editor state, so the diff goes in again.
  const [loads, setLoads] = useState(0);

  const linesRef = useRef(onLines);
  linesRef.current = onLines;
  // The right-click menu: where it opens, and the lines it acts on.
  const [menu, setMenu] = useState<{ x: number; y: number; from: number; to: number } | null>(null);
  const contextMenu = (e: MouseEvent, v: EditorView) => {
    e.preventDefault();
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
    const sel = v.state.selection.main;
    // Inside the selection: its lines. Elsewhere: the cursor moves there, as in VS Code.
    if (pos !== null && (sel.empty || pos < sel.from || pos > sel.to)) v.dispatch({ selection: { anchor: pos } });
    const now = v.state.selection.main;
    const doc = v.state.doc;
    setMenu({ x: e.clientX, y: e.clientY, from: doc.lineAt(now.from).number, to: doc.lineAt(now.to).number });
    return true;
  };
  const contextRef = useRef(contextMenu);
  contextRef.current = contextMenu;

  const setDirty = (d: boolean) => {
    dirty.current = d;
    onDirty(d);
  };

  // An autosave must not write over a change on disk that is not loaded yet (claude edited
  // the file while you typed): it waits for "Load the disk version" or "Keep mine" (⌘S).
  const conflictRef = useRef(false);
  conflictRef.current = conflict;
  const autosaveTimer = useRef(0);
  const autosave = () => {
    clearTimeout(autosaveTimer.current);
    if (!conflictRef.current) save();
  };
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  const save = async () => {
    clearTimeout(autosaveTimer.current);
    const p = open.current;
    const v = view.current;
    if (!p || !v || !dirty.current) return;
    try {
      await api.writeFile(p, v.state.doc.toString());
      setDirty(false);
      setConflict(false);
    } catch (e) {
      setError(String(e));
    }
  };

  /** Load the file from disk into the editor as one undoable step. */
  const reload = async () => {
    const p = open.current;
    const v = view.current;
    if (!p || !v) return;
    try {
      const text = await api.readFile(p);
      if (open.current !== p) return;
      const now = v.state.doc.toString();
      if (text !== now) v.dispatch({ changes: minimalChange(now, text), annotations: fromDisk.of(true) });
      setDirty(false);
      setConflict(false);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    view.current = new EditorView({ parent: host.current! });
    return () => {
      // The pane is closing (its project left the tab): keep the edits.
      const v = view.current;
      if (v && open.current && dirty.current) api.writeFile(open.current, v.state.doc.toString()).catch(console.error);
      v?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    let gone = false;
    (async () => {
      await save();
      try {
        const text = await api.readFile(path);
        const lang = LanguageDescription.matchFilename(languages, path);
        const support = lang ? await lang.load() : [];
        if (gone) return;
        open.current = path;
        setError(null);
        setConflict(false);
        setDirty(false);
        view.current!.setState(
          EditorState.create({
            doc: text,
            extensions: [
              Prec.highest(
                keymap.of([
                  { key: "Mod-s", run: () => (save(), true) },
                  // Next and previous change: VS Code's keys.
                  { key: "Alt-F5", run: goToNextChunk },
                  { key: "Shift-Alt-F5", run: goToPreviousChunk },
                ]),
              ),
              basicSetup,
              support,
              theme,
              fontSlot.current.of(fontTheme(font.current)),
              syntaxHighlighting(highlight),
              diffSlot.current.of([]),
              // Leaving the editor (another pane, the terminal, another app) saves at once.
              EditorView.domEventHandlers({
                blur: () => void autosaveRef.current(),
                contextmenu: (e, v) => contextRef.current(e, v),
              }),
              EditorView.updateListener.of((u) => {
                const local = u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk));
                if (local) {
                  if (!dirty.current) setDirty(true);
                  clearTimeout(autosaveTimer.current);
                  autosaveTimer.current = window.setTimeout(() => autosaveRef.current(), AUTOSAVE_MS);
                }
                if (u.selectionSet || u.docChanged) {
                  const sel = u.state.selection.main;
                  linesRef.current?.(u.state.doc.lineAt(sel.from).number, u.state.doc.lineAt(sel.to).number);
                }
              }),
            ],
          }),
        );
        setLoads((n) => n + 1);
      } catch (e) {
        if (!gone) setError(String(e));
      }
    })();
    return () => {
      gone = true;
    };
    // save() reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // The diff base: the file as HEAD has it ("" for a file HEAD does not have).
  useEffect(() => {
    setBase(null);
    if (!path) return;
    let gone = false;
    api.gitHeadFile(path).then((h) => !gone && setBase(h ?? ""), () => !gone && setBase(null));
    return () => {
      gone = true;
    };
  }, [path, head]);

  useEffect(() => {
    const v = view.current;
    if (!v || !path) return;
    const on = diff && base !== null;
    v.dispatch({
      effects: diffSlot.current.reconfigure(
        on
          ? unifiedMergeView({
              original: base,
              gutter: true,
              highlightChanges: true,
              syntaxHighlightDeletions: true,
              allowInlineDiffs: true,
              mergeControls: chunkButton,
            })
          : [],
      ),
    });
  }, [diff, base, path, loads]);

  // A search result: once its file is the one open (it may still be loading), go to it.
  useEffect(() => {
    const v = view.current;
    if (!v || !jump || jump.path !== open.current) return;
    const doc = v.state.doc;
    if (jump.line > doc.lines) return;
    const line = doc.line(jump.line);
    const from = Math.min(line.from + jump.from, line.to);
    const to = Math.min(line.from + jump.to, line.to);
    v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
    v.focus();
  }, [jump, loads]);

  // ⌘+ / ⌘- / ⌘0 here: this editor's font only.
  useEffect(() => {
    const el = host.current!;
    const zoom = (e: KeyboardEvent) => {
      const size = fontKey(e, font.current);
      if (size === null) return;
      e.preventDefault();
      e.stopPropagation();
      font.current = size;
      saveFont(`editor.${fontId}`, size);
      view.current?.dispatch({ effects: fontSlot.current.reconfigure(fontTheme(size)) });
    };
    el.addEventListener("keydown", zoom, true);
    return () => el.removeEventListener("keydown", zoom, true);
  }, [fontId]);

  // Changed on disk: show it now, or ask when there are unsaved edits here.
  useEffect(() => {
    if (!path) return;
    return onFsChange((paths) => {
      if (!paths.includes(path)) return;
      if (dirty.current) setConflict(true);
      else reload();
    });
    // reload() reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <div className="relative flex h-full flex-col select-text">
      {conflict && (
        <div className="flex shrink-0 items-center gap-3 border-b border-[#e2c08d]/30 bg-[#e2c08d]/10 px-3 py-1.5 text-[12px] text-[#e2c08d]">
          <span>This file changed on disk, and you have unsaved edits.</span>
          <button onClick={reload} className="ml-auto rounded-md px-2 py-0.5 ring-1 ring-inset ring-[#e2c08d]/40 hover:bg-[#e2c08d]/10">
            Load the disk version
          </button>
          <button onClick={() => save()} className="rounded-md px-2 py-0.5 text-muted hover:text-fg">
            Keep mine
          </button>
        </div>
      )}
      <div ref={host} className={["min-h-0 flex-1", path && !error ? "" : "hidden"].join(" ")} />
      {menu && (
        <EditorMenu
          at={menu}
          view={view.current}
          onGithub={onGithub && ((copy) => onGithub(copy, menu.from, menu.to))}
          onClose={() => setMenu(null)}
        />
      )}
      {(!path || error) && (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted">
          {error ?? "Pick a file in the tree"}
        </div>
      )}
    </div>
  );
}

/** The editor's right-click menu: the lines on GitHub, and the usual Cut / Copy / Paste (it
 *  stands in for the system menu, so those must be here). */
function EditorMenu({
  at,
  view,
  onGithub,
  onClose,
}: {
  at: { x: number; y: number; from: number; to: number };
  view: EditorView | null;
  onGithub?: (copy: boolean) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const sel = view?.state.selection.main;
  const selected = sel && !sel.empty ? view!.state.sliceDoc(sel.from, sel.to) : "";
  const run = (fn: () => void | Promise<void>) => async () => {
    onClose();
    await fn();
    view?.focus();
  };
  const copy = () => navigator.clipboard.writeText(selected);
  const cut = async () => {
    await navigator.clipboard.writeText(selected);
    if (view && sel) view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" } });
  };
  const paste = async () => {
    const text = await navigator.clipboard.readText().catch(() => "");
    if (view && text) view.dispatch(view.state.replaceSelection(text));
  };
  const lines = at.from === at.to ? `line ${at.from}` : `lines ${at.from}–${at.to}`;
  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-text hover:bg-[#04395e] disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div
      ref={box}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: Math.min(at.x, window.innerWidth - 250), top: Math.min(at.y, window.innerHeight - 220) }}
      className="fixed z-50 w-[240px] rounded-lg bg-card p-1 shadow-float ring-1 ring-inset ring-white/[0.2]"
    >
      {onGithub && (
        <>
          <button onClick={run(() => onGithub(false))} className={item}>
            <Icon name="github" className="h-3.5 w-3.5 text-muted" />
            Open on GitHub
            <span className="ml-auto text-[11px] text-faint">{lines}</span>
          </button>
          <button onClick={run(() => onGithub(true))} className={item}>
            <Icon name="clone" className="h-3.5 w-3.5 rotate-180 text-muted" />
            Copy GitHub link
          </button>
          <div className="my-1 h-px bg-[#2b2b2b]" />
        </>
      )}
      <button onClick={run(cut)} disabled={!selected} className={item}>
        Cut<span className="ml-auto text-[11px] text-faint">⌘X</span>
      </button>
      <button onClick={run(copy)} disabled={!selected} className={item}>
        Copy<span className="ml-auto text-[11px] text-faint">⌘C</span>
      </button>
      <button onClick={run(paste)} className={item}>
        Paste<span className="ml-auto text-[11px] text-faint">⌘V</span>
      </button>
    </div>
  );
}
