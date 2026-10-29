"use client";

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css, cssLanguage } from "@codemirror/lang-css";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

import { THEME_VARIABLES, classNameStart } from "@/lib/css-completions";

/**
 * The CSS panel's editor (D394): CodeMirror with CSS's own highlighting and completion (properties, values, at-rules, pseudo-classes),
 * Tab to indent (Escape, then Tab, leaves it, as CodeMirror's own rule), brackets closed as they are typed and the site's own names
 * offered: the theme's variables after `var(` and the page's and the site's classes after a `.`. Loaded only when the panel opens
 * (`lazy/css-code-editor.tsx`); until then, and where it cannot load, the panel draws its plain field. Colours are the admin's roles, so it
 * follows the scheme in light and dark. The text is still only checked by `cssProblem()` and drawn by `<CustomCss>`/`<ScopedCss>`.
 */

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.attributeName], color: "var(--insight-text)" },
  { tag: [t.number, t.unit, t.color, t.atom, t.bool, t.keyword], color: "var(--positive-text)" },
  { tag: [t.string, t.special(t.string)], color: "var(--warning-text)" },
  { tag: [t.className, t.tagName, t.labelName, t.constant(t.className)], color: "var(--ink)", fontWeight: "500" },
  { tag: [t.definitionKeyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "var(--danger-text)" },
  { tag: [t.variableName, t.special(t.variableName)], color: "var(--brand-text)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.punctuation, t.bracket, t.separator], color: "var(--ink-2)" },
]);

const look = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--sunken)", color: "var(--ink)", fontSize: "13px", borderRadius: "6px", border: "1px solid var(--line)" },
  "&.cm-focused": { outline: "2px solid var(--brand)", outlineOffset: "1px" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.6" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--ink)" },
  ".cm-gutters": { backgroundColor: "var(--sunken)", color: "var(--muted)", border: "none", borderTopLeftRadius: "6px", borderBottomLeftRadius: "6px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--ink) 5%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink-2)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--brand) 30%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--brand) 25%, transparent)", outline: "none" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-tooltip": { backgroundColor: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: "6px", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--brand)", color: "var(--brand-ink)" },
  ".cm-completionDetail": { color: "inherit", opacity: "0.7", marginLeft: "1em", fontStyle: "normal" },
});

/** Inside a comment or a string nothing is offered of the site's own. */
const quiet = (context: CompletionContext) => {
  const name = syntaxTree(context.state).resolveInner(context.pos, -1).name;
  return name === "Comment" || name === "StringLiteral";
};

/** The theme's variables after `var(` (with or without the `--` typed). */
function variables(context: CompletionContext): CompletionResult | null {
  if (quiet(context)) return null;
  const word = context.matchBefore(/var\(\s*-{0,2}[\w-]*$/);
  if (!word) return null;
  const typed = /-{0,2}[\w-]*$/.exec(word.text)?.[0] ?? "";
  const from = context.pos - typed.length;
  return { from, options: THEME_VARIABLES.map(({ name, detail }) => ({ label: name, detail, type: "variable" })), validFor: /^-{0,2}[\w-]*$/ };
}

/** Classes the page and the site use, after a `.` that starts a class. */
const classes = (names: readonly string[]) => (context: CompletionContext): CompletionResult | null => {
  if (names.length === 0 || quiet(context)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const dot = classNameStart(before);
  if (dot === null) return null;
  return { from: line.from + dot + 1, options: names.map((name) => ({ label: name, type: "class", boost: name.startsWith("ts-") ? 1 : 0 })), validFor: /^-?[\w-]*$/ };
};

export default function CssCodeEditor({
  id,
  value,
  onChange,
  max,
  placeholderText,
  labelledBy,
  describedBy,
  invalid,
  classNames,
}: {
  id: string;
  value: string;
  onChange: (css: string) => void;
  /** At most this many characters (`CSS_MAX`): a change that would pass it is refused, as the plain field's `maxLength` does. */
  max: number;
  placeholderText: string;
  labelledBy: string;
  describedBy: string;
  invalid: boolean;
  /** The classes the page's parts and the site's text styles have (`knownClassNames()`). */
  classNames: readonly string[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  });

  // The editor is made once; the panel gives it a new `key` when its tab changes.
  useEffect(() => {
    if (!host.current) return;
    const made = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          css(),
          cssLanguage.data.of({ autocomplete: variables }),
          cssLanguage.data.of({ autocomplete: classes(classNames) }),
          autocompletion({ icons: false }),
          syntaxHighlighting(highlight),
          look,
          placeholder(placeholderText),
          EditorState.tabSize.of(2),
          EditorState.transactionFilter.of((tr) => (tr.docChanged && tr.newDoc.length > max && tr.newDoc.length > tr.startState.doc.length ? [] : tr)),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            id,
            "aria-labelledby": labelledBy,
            "aria-describedby": describedBy,
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = made;
    return () => {
      made.destroy();
      view.current = null;
    };
    // Made once per mount: the words then come from the editor itself; outside changes arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change from outside (a version taken back): the editor takes it when it differs from what it holds.
  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
  }, [value]);

  // The invalid mark is on the editable part, where assistive technology reads it.
  useEffect(() => {
    const content = view.current?.contentDOM;
    if (!content) return;
    if (invalid) content.setAttribute("aria-invalid", "true");
    else content.removeAttribute("aria-invalid");
  }, [invalid]);

  return <div ref={host} data-css-editor="" className="min-h-0 flex-1 overflow-hidden" />;
}
