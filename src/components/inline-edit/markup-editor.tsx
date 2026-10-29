"use client";

import { Mark, Node } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { UndoRedo } from "@tiptap/extensions";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { docToMarkup, markupToDoc, withStyleClass, MARK_ORDER, type MarkupDoc } from "@/lib/inline-doc";
import { fillWords } from "@/lib/admin-fill";
import { cleanHeadingText } from "@/lib/inline-edit";
import { slugOfClass, textStyleClass } from "@/lib/text-styles";

import { useAdminText } from "../admin/admin-text";
import { StyleMenu } from "../admin/text-styles";
import { FloatingBar } from "./floating-bar";

/**
 * A heading edited where it stands, showing its words as they look (D393, `docs/text-styles.md` 2; replaces the plain-text editing of
 * D191 on the builder's canvas): a one-line editor whose marks are inline markup's elements (`src/lib/inline-doc.ts`), so a text style,
 * bold or a link shows as the page draws it, and what it writes back is the same markup. Select words and a bar floats over them with
 * Bold, Italic and *Style*. Enter ends it, Escape puts back what it was, a paste is plain text and the text is held to the heading's limit.
 */

/** The one line: the document holds inline content only. */
const OneLine = Node.create({ name: "doc", topNode: true, content: "inline*" });
const Text = Node.create({ name: "text", group: "inline" });
const HardBreak = Node.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
});

/** One mark per element of inline markup, in `MARK_ORDER` (outermost first); a span keeps its classes, a link its address. */
const MARKS = MARK_ORDER.map((tag, index) =>
  Mark.create({
    name: `m_${tag}`,
    priority: 1000 - index,
    addAttributes() {
      return {
        className: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("class"), renderHTML: (attrs: { className?: string | null }) => (attrs.className ? { class: attrs.className } : {}) },
        ...(tag === "a" && { href: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("href"), renderHTML: (attrs: { href?: string | null }) => (attrs.href ? { href: attrs.href } : {}) } }),
      };
    },
    parseHTML: () => [{ tag }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
  }),
);

export const MARKUP_EXTENSIONS = [OneLine, Text, HardBreak, UndoRedo, ...MARKS];

export function InlineMarkupEditor({
  level,
  className,
  text,
  point,
  endOnBlur = true,
  actions,
  onChange,
  onDone,
}: {
  level: number;
  /** The classes the page gives the heading. */
  className: string;
  /** The text to start from, inline markup and all; later changes come from the editor itself. */
  text: string;
  point: { x: number; y: number } | null;
  endOnBlur?: boolean;
  /** More controls in its bar, after the formatting (the live site's Save and Cancel). */
  actions?: ReactNode;
  onChange: (text: string) => void;
  onDone: (how: "save" | "cancel") => void;
}) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const headingWord = useAdminText("builder").heading.heading;
  const [start] = useState(() => ({ text, point }));
  const done = useRef(false);
  const finish = (how: "save" | "cancel") => {
    if (done.current) return;
    done.current = true;
    if (how === "cancel") onChange(start.text);
    onDone(how);
  };
  const editor = useEditor({
    extensions: MARKUP_EXTENSIONS,
    content: markupToDoc(start.text),
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "outline-none", "aria-label": headingWord, "aria-multiline": "false", role: "textbox", spellcheck: "true" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finish("save");
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish("cancel");
          return true;
        }
        return false;
      },
      // A paste is plain text, as the heading's words are; a drop never comes in.
      handlePaste: (view, event) => {
        const pasted = cleanHeadingText(event.clipboardData?.getData("text/plain") ?? "");
        if (pasted) view.dispatch(view.state.tr.insertText(pasted));
        return true;
      },
      handleDrop: () => true,
    },
    onUpdate: ({ editor: current }) => onChange(cleanHeadingText(docToMarkup(current.getJSON() as MarkupDoc))),
  });

  useEffect(() => {
    if (!editor) return;
    const at = start.point ? editor.view.posAtCoords({ left: start.point.x, top: start.point.y })?.pos : undefined;
    editor.commands.focus(at ?? "end", { scrollIntoView: false });
  }, [editor, start]);

  const Tag = `h${Math.min(Math.max(Math.round(level), 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <div
      ref={wrapper}
      data-inline-editing="heading"
      onBlur={(event) => {
        // The window losing the focus, the focus moving to its bar or into a dialog opened from it (a new style) does not end it.
        if (!endOnBlur || !document.hasFocus()) return;
        const next = event.relatedTarget;
        if (next instanceof globalThis.Node && (wrapper.current?.contains(next) || bar.current?.contains(next) || (next instanceof Element && next.closest("dialog")))) return;
        finish("save");
      }}
    >
      <Tag className={`${className} cursor-text rounded-sm outline-2 outline-offset-4 outline-blue-600/70 focus-within:outline-blue-600`}>
        <EditorContent editor={editor} />
      </Tag>
      {editor && <MarkupBar editor={editor} anchor={wrapper} barRef={bar} label={headingWord} actions={actions} />}
    </div>
  );
}

/** The bar over the selected words: Bold, Italic and *Style* (a text style on the selection, or off). */
export function MarkupBar({
  editor,
  anchor,
  barRef,
  label,
  actions,
}: {
  editor: Editor;
  anchor: React.RefObject<HTMLDivElement | null>;
  barRef: React.RefObject<HTMLDivElement | null>;
  /** What the words are, for the bar's name ("Formatting for …"). */
  label: string;
  actions?: ReactNode;
}) {
  const w = useAdminText("builder").richText;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      selected: !e.state.selection.empty,
      bold: e.isActive("m_strong"),
      italic: e.isActive("m_em"),
      spanClass: (e.getAttributes("m_span").className as string | null | undefined) ?? null,
    }),
  });
  const style = (state.spanClass ?? "").split(/\s+/).map(slugOfClass).find(Boolean) ?? null;
  const tool = "flex min-h-9 min-w-9 items-center justify-center rounded px-2 text-sm hover:bg-sunken aria-pressed:bg-inverse aria-pressed:text-inverse-ink";
  return (
    <FloatingBar anchor={anchor} barRef={barRef}>
      <div role="toolbar" aria-label={fillWords(w.toolbar, { label })} className="flex items-center gap-0.5 p-1">
        <button type="button" title={w.bold} aria-label={w.bold} aria-pressed={state.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleMark("m_strong").run()} className={tool}>
          <strong>B</strong>
        </button>
        <button type="button" title={w.italic} aria-label={w.italic} aria-pressed={state.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleMark("m_em").run()} className={tool}>
          <em className="font-serif">I</em>
        </button>
        <StyleMenu
          active={style}
          hasSelection={state.selected}
          apply={(slug) => {
            let next = editor.chain().focus();
            if (editor.state.selection.empty && style) next = next.extendMarkRange("m_span");
            const className = withStyleClass(state.spanClass, slug ? textStyleClass(slug) : null);
            (className ? next.setMark("m_span", { className }) : next.unsetMark("m_span")).run();
          }}
        />
      </div>
      {actions}
    </FloatingBar>
  );
}
