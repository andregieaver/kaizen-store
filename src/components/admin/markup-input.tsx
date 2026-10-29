"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import { docToMarkup, markupToDoc, type MarkupDoc } from "@/lib/inline-doc";

import { MARKUP_EXTENSIONS, MarkupBar } from "../inline-edit/markup-editor";

/**
 * A plain text field of the settings panel that takes inline markup (D191: a heading, a button's words, a caption, a title, a list's line,
 * a quote; D393 step 2, `docs/text-styles.md` 2), drawn as its words look: bold, a link or a text style show as they will on the page, and
 * what it gives back is the same inline markup, so nobody types a tag. Focused, a bar floats over it with Bold, Italic and *Style*. One
 * line unless `multiline` (Shift+Enter then makes a line break); a paste is plain text; never longer than `max` characters of markup.
 * Its label is the `<label for>` the field had: the editor takes the label's name and a press on it focuses the words.
 */
export function MarkupInput({
  id,
  value,
  onChange,
  max,
  placeholder,
  multiline = false,
  className = "",
  label,
}: {
  id: string;
  /** What the field holds, for its bar's name. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  // The markup this field last gave back, so a change from outside (Undo, another language) is told from its own.
  const last = useRef(value);
  const [focused, setFocused] = useState(false);
  const editor = useEditor({
    extensions: MARKUP_EXTENSIONS,
    content: markupToDoc(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": String(multiline),
        class: `block min-h-10 w-full whitespace-pre-wrap break-words px-3 py-2 text-sm outline-none ${className}`,
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "Enter") return false;
        event.preventDefault();
        if (multiline && event.shiftKey) view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.hardBreak.create()).scrollIntoView());
        return true;
      },
      handlePaste: (view, event) => {
        const pasted = (event.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/g, " ");
        if (pasted) view.dispatch(view.state.tr.insertText(pasted));
        return true;
      },
      handleDrop: () => true,
      // Never past the field's limit, counted as the markup it is kept as.
      handleTextInput: (_view, _from, _to, text) => max !== undefined && last.current.length + text.length > max,
    },
    onUpdate: ({ editor: current }) => {
      const markup = docToMarkup(current.getJSON() as MarkupDoc);
      last.current = markup;
      onChange(markup);
    },
  });

  // A change from outside the field is shown, without telling it back.
  useEffect(() => {
    if (!editor || value === last.current) return;
    last.current = value;
    editor.commands.setContent(markupToDoc(value), { emitUpdate: false });
  }, [editor, value]);

  // The field's `<label for>` names the editor and focuses it when pressed.
  useEffect(() => {
    if (!editor) return;
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
    if (!label) return;
    if (!label.id) label.id = `${id}-label`;
    editor.view.dom.setAttribute("aria-labelledby", label.id);
    const focus = () => editor.commands.focus();
    label.addEventListener("click", focus);
    return () => label.removeEventListener("click", focus);
  }, [editor, id]);

  return (
    <div
      ref={wrapper}
      data-markup-input=""
      data-max-length={max}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && (wrapper.current?.contains(next) || bar.current?.contains(next) || (next instanceof Element && next.closest("dialog")))) return;
        setFocused(false);
      }}
      className="relative rounded-md border border-line bg-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30"
    >
      <EditorContent editor={editor} />
      {placeholder && value === "" && (
        <span aria-hidden className="pointer-events-none absolute left-3 top-2 text-sm text-muted">
          {placeholder}
        </span>
      )}
      {editor && focused && <MarkupBar editor={editor} anchor={wrapper} barRef={bar} label={label} />}
    </div>
  );
}
