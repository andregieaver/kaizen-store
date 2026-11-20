"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { ContractField } from "@/lib/contract-field-keys";
import type { RichTextDoc } from "@/lib/rich-text-doc";

import { ListIcon, NumberedIcon, toolButton } from "../rich-text-tools";
import { Select } from "../ui/field";

/**
 * A contract's paragraph or clause as rich text (D695): Tiptap limited to what a contract takes (`contract-rich.ts`): paragraphs, bulleted
 * and numbered lists, line breaks, bold, italic and underline. No heading inside (a heading is its own block), no link and no colour. Homer
 * types and presses B or a list; a field goes in from *Insert a field* as `{key}`, filled in when the contract goes out. It writes JSON,
 * which the server checks again (`parseBlocks()`) and the contract draws as elements, never as HTML.
 */

type Words = DealsMessages["contracts"];

export const CONTRACT_TEXT_EXTENSIONS = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    strike: false,
    horizontalRule: false,
    link: false,
  }),
];

export function ContractTextEditor({
  value,
  onChange,
  label,
  words,
  fields,
}: {
  /** The starting document; later changes come from the editor itself. */
  value: RichTextDoc;
  onChange: (doc: RichTextDoc) => void;
  label: string;
  words: Words;
  /** The fields *Insert a field* offers (`CONTRACT_FIELDS`, handed in so this script does not carry the schema). */
  fields: readonly ContractField[];
}) {
  const editor = useEditor({
    extensions: CONTRACT_TEXT_EXTENSIONS,
    content: value,
    // Drawn in the browser only: the admin page is not prerendered.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-24 px-3 py-2 text-sm leading-relaxed focus:outline-none [&_li+li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p+ol]:mt-3 [&_p+p]:mt-3 [&_p+ul]:mt-3 [&_ol+p]:mt-3 [&_ul+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-6",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichTextDoc),
  });
  return (
    <div className="rounded-md border border-line bg-card focus-within:border-brand">
      {editor ? <Toolbar editor={editor} label={label} words={words} fields={fields} /> : <div className="h-11 border-b border-line" />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, label, words: w, fields }: { editor: Editor; label: string; words: Words; fields: readonly ContractField[] }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const t = w.format;
  const chain = () => editor.chain().focus();
  const button = toolButton;
  return (
    <div role="toolbar" aria-label={t.toolbar.replace("{label}", label)} className="flex flex-wrap items-center gap-0.5 border-b border-line p-1">
      {button(t.bold, state.bold, () => chain().toggleBold().run(), <strong>B</strong>)}
      {button(t.italic, state.italic, () => chain().toggleItalic().run(), <em className="font-serif">I</em>)}
      {button(t.underline, state.underline, () => chain().toggleUnderline().run(), <u>U</u>)}
      <span aria-hidden className="mx-1 h-6 w-px bg-line" />
      {button(t.bullets, state.bulletList, () => chain().toggleBulletList().run(), <ListIcon />)}
      {button(t.numbers, state.orderedList, () => chain().toggleOrderedList().run(), <NumberedIcon />)}
      <span aria-hidden className="mx-1 h-6 w-px bg-line" />
      {button(t.undo, undefined, () => chain().undo().run(), <span aria-hidden>↶</span>, !state.canUndo)}
      {button(t.redo, undefined, () => chain().redo().run(), <span aria-hidden>↷</span>, !state.canRedo)}
      <span aria-hidden className="mx-1 h-6 w-px bg-line" />
      <label className="sr-only" htmlFor={`${editor.instanceId}-field`}>
        {t.insertField}
      </label>
      <Select
        dense
        id={`${editor.instanceId}-field`}
        value=""
        onChange={(event) => {
          const key = event.target.value;
          if (key) chain().insertContent(`{${key}}`).run();
        }}
        className="max-w-56"
      >
        <option value="">{t.insertField}</option>
        {fields.map((key) => (
          <option key={key} value={key}>
            {w.fields[key]}
          </option>
        ))}
      </Select>
    </div>
  );
}
