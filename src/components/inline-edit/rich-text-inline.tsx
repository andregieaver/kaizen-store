"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import type { RichTextDoc } from "@/lib/page-content";

import { RICH_TEXT_EXTENSIONS, RichTextToolbar } from "../admin/rich-text-editor";
import { FloatingBar } from "./floating-bar";

/**
 * A rich text edited where it stands (D191): the same editor as the page builder's panel (`RICH_TEXT_EXTENSIONS`: headings, bold,
 * italic, underline, links, a colour, lists, quotes and lines), its content drawn in the classes the page draws rich text in, so it
 * looks as it will, with the formatting bar floating over it. It ends when the focus leaves the text and its bar; Escape puts back
 * what it was.
 */
export function InlineRichEditor({
  doc,
  point,
  label,
  onChange,
  onDone,
}: {
  /** The document to start from; later changes come from the editor itself. */
  doc: RichTextDoc;
  /** Where it was pressed, to put the caret there. */
  point: { x: number; y: number } | null;
  label: string;
  onChange: (doc: RichTextDoc) => void;
  onDone: (how: "save" | "cancel") => void;
}) {
  const wrapper = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  // What it started from: the document, to put back on Escape, and the press that started it.
  const [start] = useState(() => ({ doc, point }));
  const done = useRef(false);
  const finish = (how: "save" | "cancel") => {
    if (done.current) return;
    done.current = true;
    if (how === "cancel") onChange(start.doc);
    onDone(how);
  };

  const editor = useEditor({
    extensions: RICH_TEXT_EXTENSIONS,
    content: start.doc,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rich-text min-h-[1.5em] cursor-text rounded-sm outline-2 outline-offset-4 outline-blue-600/70 focus:outline-blue-600",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape") return false;
        event.preventDefault();
        finish("cancel");
        return true;
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as RichTextDoc),
  });

  // The caret where the press was, else at the end.
  useEffect(() => {
    if (!editor) return;
    const at = start.point ? editor.view.posAtCoords({ left: start.point.x, top: start.point.y })?.pos : undefined;
    editor.commands.focus(at ?? "end", { scrollIntoView: false });
  }, [editor, start]);

  return (
    <div
      ref={wrapper}
      onBlur={(event) => {
        // The window losing the focus does not end it, nor does the focus moving between the text and its bar.
        if (!document.hasFocus()) return;
        const next = event.relatedTarget;
        if (next instanceof Node && (wrapper.current?.contains(next) || bar.current?.contains(next))) return;
        finish("save");
      }}
    >
      <EditorContent editor={editor} />
      {editor && (
        <FloatingBar anchor={wrapper} barRef={bar}>
          <RichTextToolbar editor={editor} label={label} />
        </FloatingBar>
      )}
    </div>
  );
}
