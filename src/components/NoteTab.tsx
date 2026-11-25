import { useEffect, useRef, useState } from "react";
import { Compartment, EditorSelection, EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import type { Tab } from "../types";
import { C, MONO } from "../lib/theme";
import { fontKey, loadFont, saveFont } from "../lib/fontSize";
import { Icon } from "./Icons";

// The page as you write: Markdown with its marks dimmed, headings large, code in mono.
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: C.text },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif", lineHeight: "1.65", padding: "16px 20px" },
  ".cm-content": { caretColor: "#ffffff", maxWidth: "860px" },
  ".cm-cursor": { borderLeftColor: "#ffffff" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#264f78" },
  ".cm-placeholder": { color: C.faint },
  // A code block as Slack draws it while you type: a box around its lines, fences included.
  ".cm-cb": { fontFamily: MONO, fontSize: "0.92em", backgroundColor: "rgba(255,255,255,0.05)", borderLeft: "1px solid rgba(255,255,255,0.14)", borderRight: "1px solid rgba(255,255,255,0.14)", padding: "0 12px" },
  ".cm-cb span": { color: "#d4d4d4", fontSize: "1em" },
  ".cm-cb-first": { borderTop: "1px solid rgba(255,255,255,0.14)", borderTopLeftRadius: "6px", borderTopRightRadius: "6px", paddingTop: "4px" },
  ".cm-cb-last": { borderBottom: "1px solid rgba(255,255,255,0.14)", borderBottomLeftRadius: "6px", borderBottomRightRadius: "6px", paddingBottom: "4px" },
  ".cm-ic": { backgroundColor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "0 3px" },
});

// The boxes: each line of a fenced or indented code block, and each inline `code`.
const codeLine = (cls: string) => Decoration.line({ class: cls });
const codeBoxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const marks: { from: number; to: number; deco: Decoration }[] = [];
      const hidden: { from: number; to: number }[] = [];
      const doc = view.state.doc;
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (n) => {
            if (n.name === "FencedCode" || n.name === "CodeBlock") {
              const first = doc.lineAt(n.from).number;
              const last = doc.lineAt(n.to).number;
              // A closed block hides its ``` fences, as Slack does; they come back while the
              // cursor is in the block, to edit them.
              const sel = view.state.selection.main;
              const inside = sel.to >= n.from && sel.from <= n.to;
              const fences = n.node.getChildren("CodeMark");
              if (n.name === "FencedCode" && fences.length >= 2 && !inside) {
                for (const m of fences) {
                  const line = doc.lineAt(m.from);
                  const info = n.node.getChild("CodeInfo");
                  const end = info && doc.lineAt(info.from).number === line.number ? info.to : m.to;
                  hidden.push({ from: m.from, to: end });
                }
              }
              for (let l = first; l <= last; l++) {
                const cls = ["cm-cb", l === first ? "cm-cb-first" : "", l === last ? "cm-cb-last" : ""].join(" ").trim();
                marks.push({ from: doc.line(l).from, to: doc.line(l).from, deco: codeLine(cls) });
              }
              return false;
            }
            if (n.name === "InlineCode") marks.push({ from: n.from, to: n.to, deco: Decoration.mark({ class: "cm-ic" }) });
          },
        });
      }
      for (const h of hidden) marks.push({ from: h.from, to: h.to, deco: Decoration.replace({}) });
      marks.sort((a, b) => a.from - b.from || a.to - b.to);
      const b = new RangeSetBuilder<Decoration>();
      let lastLine = -1;
      for (const m of marks) {
        // A line decoration once per line (two visible ranges can meet on one).
        if (m.from === m.to) {
          if (m.from === lastLine) continue;
          lastLine = m.from;
        }
        b.add(m.from, m.to, m.deco);
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);
const style = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.7em", fontWeight: "700", color: C.fg },
  { tag: t.heading2, fontSize: "1.4em", fontWeight: "700", color: C.fg },
  { tag: t.heading3, fontSize: "1.2em", fontWeight: "600", color: C.fg },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600", color: C.fg },
  { tag: t.strong, fontWeight: "700", color: C.fg },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: MONO, fontSize: "0.92em", color: "#e2c08d" },
  { tag: [t.link, t.url], color: "#4daafc" },
  { tag: t.quote, color: C.muted, fontStyle: "italic" },
  { tag: t.contentSeparator, color: C.faint },
  { tag: [t.processingInstruction, t.meta, t.labelName], color: C.faint },
]);

/** Slack's code buttons. Inline: the selection in backticks (none: a pair, the cursor in it). */
function inlineCode(v: EditorView) {
  v.dispatch(
    v.state.changeByRange((r) => ({
      changes: [{ from: r.from, insert: "`" }, { from: r.to, insert: "`" }],
      range: r.empty ? EditorSelection.cursor(r.from + 1) : EditorSelection.range(r.from + 1, r.to + 1),
    })),
  );
  v.focus();
  return true;
}

/** Block: the selected lines between ``` fences (none: an empty block, the cursor in it). */
function codeBlock(v: EditorView) {
  const doc = v.state.doc;
  v.dispatch(
    v.state.changeByRange((r) => {
      const first = doc.lineAt(r.from);
      const last = doc.lineAt(r.to);
      if (r.empty && first.length === 0) {
        return { changes: { from: first.from, insert: "```\n\n```" }, range: EditorSelection.cursor(first.from + 4) };
      }
      const open = "```\n";
      return {
        changes: [{ from: first.from, insert: open }, { from: last.to, insert: "\n```" }],
        range: EditorSelection.range(first.from + open.length, last.to + open.length),
      };
    }),
  );
  v.focus();
  return true;
}

/** A text tab: one page of Markdown, formatted as you write (as Slack does). The text is
 *  saved with the tabs (layout), so it comes back after a restart. */
export function NoteTab({ tab, active, onText }: { tab: Tab; active: boolean; onText: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const fontSlot = useRef(new Compartment());
  const [size, setSize] = useState(() => loadFont(`note.${tab.id}`));
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: tab.text ?? "",
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(style),
          codeBoxes,
          EditorView.lineWrapping,
          placeholder("Write anything… Markdown works: # heading, **bold**, - list, `code`, ``` code block."),
          theme,
          fontSlot.current.of(EditorView.theme({ "&": { fontSize: `${sizeRef.current}px` } })),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onTextRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // One editor for the tab's life; its text lives in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: fontSlot.current.reconfigure(EditorView.theme({ "&": { fontSize: `${size}px` } })) });
  }, [size]);

  // The page takes the cursor when its tab opens.
  useEffect(() => {
    if (active) requestAnimationFrame(() => view.current?.focus());
  }, [active]);

  return (
    <div className={active ? "absolute inset-0 flex pb-3 pl-[var(--gap-left)] pr-3 pt-1.5" : "hidden"}>
      <section
        tabIndex={-1}
        // ⌘+ / ⌘- / ⌘0: this page's font only, as in a terminal or an editor.
        onKeyDown={(e) => {
          const next = fontKey(e.nativeEvent, size);
          if (next === null) return;
          e.preventDefault();
          setSize(next);
          saveFont(`note.${tab.id}`, next);
        }}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md tab-edge bg-panel"
      >
        {/* Slack's code buttons; mouse down does not take the focus (the selection stays). */}
        <div className="absolute right-2.5 top-2.5 z-10 flex gap-0.5">
          {([
            ["code", "Code", inlineCode],
            ["codeBlock", "Code block", codeBlock],
          ] as const).map(([icon, title, run]) => (
            <button
              key={icon}
              title={title}
              aria-label={title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => view.current && run(view.current)}
              className="rounded-md p-1.5 text-muted hover:bg-white/[0.08] hover:text-fg"
            >
              <Icon name={icon} className="h-4 w-4" />
            </button>
          ))}
        </div>
        <div ref={host} className="min-h-0 flex-1 select-text" />
      </section>
    </div>
  );
}
