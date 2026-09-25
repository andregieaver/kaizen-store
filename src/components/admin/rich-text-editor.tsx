"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { useId, useState, type ReactNode } from "react";

import { isLinkAddress, type RichTextDoc } from "@/lib/page-content";

/**
 * A rich-text block in the page editor (D42): Tiptap (ProseMirror) in the
 * browser, limited to what pages show: headings 2–4, paragraphs, bold,
 * italic, underline, links, lists, quotes and lines. It writes JSON, which
 * the server checks again and the site renders as elements, never as HTML.
 */

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    code: false,
    codeBlock: false,
    strike: false,
    link: {
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      isAllowedUri: (url) => isLinkAddress(url),
      HTMLAttributes: { target: null, rel: null },
    },
  }),
  Placeholder.configure({ placeholder: "Write here …" }),
];

/** What a person types as a link: "kaizen.no" means https://kaizen.no. */
export function linkFromInput(value: string): string {
  const text = value.trim();
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)) return `https://${text}`;
  if (/^[^@\s/:]+@[^@\s]+\.[^@\s]+$/.test(text)) return `mailto:${text}`;
  return text;
}

const tool =
  "flex min-h-9 min-w-9 items-center justify-center rounded px-2 text-sm hover:bg-surface aria-pressed:bg-foreground aria-pressed:text-background disabled:opacity-40";

export function RichTextEditor({
  value,
  onChange,
  label,
}: {
  /** The starting document; later changes come from the editor itself. */
  value: RichTextDoc;
  onChange: (doc: RichTextDoc) => void;
  label: string;
}) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value,
    // Rendered in the browser only: the admin page is not prerendered.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rich-text min-h-32 px-4 py-3 focus:outline-none",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichTextDoc),
  });

  return (
    <div className="rounded-md border border-border bg-background focus-within:border-foreground">
      {editor ? <Toolbar editor={editor} label={label} /> : <div className="h-11 border-b border-border" />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, label }: { editor: Editor; label: string }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive("heading", { level: 2 })
        ? "h2"
        : e.isActive("heading", { level: 3 })
          ? "h3"
          : e.isActive("heading", { level: 4 })
            ? "h4"
            : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linking, setLinking] = useState(false);
  const chain = () => editor.chain().focus();

  const button = (name: string, pressed: boolean | undefined, run: () => void, children: ReactNode, disabled = false) => (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={pressed}
      disabled={disabled}
      // Keep the text selected while the toolbar is used.
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
      className={tool}
    >
      {children}
    </button>
  );

  return (
    <div className="sticky top-0 z-10 rounded-t-md border-b border-border bg-background">
      <div role="toolbar" aria-label={`Formatting for ${label}`} className="flex flex-wrap items-center gap-0.5 p-1">
        <label className="sr-only" htmlFor={`${editor.instanceId}-style`}>
          Text style
        </label>
        <select
          id={`${editor.instanceId}-style`}
          value={state.style}
          onChange={(event) => {
            const style = event.target.value;
            if (style === "p") chain().setParagraph().run();
            else chain().setHeading({ level: Number(style.slice(1)) as 2 | 3 | 4 }).run();
          }}
          className="min-h-9 rounded border border-border bg-background px-2 text-sm"
        >
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="h4">Small heading</option>
        </select>
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        {button("Bold", state.bold, () => chain().toggleBold().run(), <strong>B</strong>)}
        {button("Italic", state.italic, () => chain().toggleItalic().run(), <em className="font-serif">I</em>)}
        {button("Underline", state.underline, () => chain().toggleUnderline().run(), <u>U</u>)}
        {button("Link", state.link || linking, () => setLinking((open) => !open), <LinkIcon />)}
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        {button("Bulleted list", state.bulletList, () => chain().toggleBulletList().run(), <ListIcon />)}
        {button("Numbered list", state.orderedList, () => chain().toggleOrderedList().run(), <NumberedIcon />)}
        {button("Quote", state.blockquote, () => chain().toggleBlockquote().run(), <QuoteIcon />)}
        {button("Line", undefined, () => chain().setHorizontalRule().run(), <span aria-hidden>―</span>)}
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        {button("Undo", undefined, () => chain().undo().run(), <span aria-hidden>↶</span>, !state.canUndo)}
        {button("Redo", undefined, () => chain().redo().run(), <span aria-hidden>↷</span>, !state.canRedo)}
      </div>
      {linking && (
        <LinkForm
          key={state.href}
          initial={state.href}
          active={state.link}
          onApply={(href) => {
            const { empty } = editor.state.selection;
            if (empty && !state.link) {
              chain()
                .insertContent({ type: "text", text: href.replace(/^(mailto|tel):/, ""), marks: [{ type: "link", attrs: { href } }] })
                .run();
            } else {
              chain().extendMarkRange("link").setLink({ href }).run();
            }
            setLinking(false);
          }}
          onRemove={() => {
            chain().extendMarkRange("link").unsetLink().run();
            setLinking(false);
          }}
          onCancel={() => {
            setLinking(false);
            editor.commands.focus();
          }}
        />
      )}
    </div>
  );
}

function LinkForm({
  initial,
  active,
  onApply,
  onRemove,
  onCancel,
}: {
  initial: string;
  active: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const apply = () => {
    const href = linkFromInput(value);
    if (!isLinkAddress(href)) {
      setProblem("Use a web address (https://…), an email address, tel:+47… or a path on this site starting with /.");
      return;
    }
    onApply(href);
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          Link to
        </label>
        <input
          id={id}
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="https://… or /sign-up"
          inputMode="url"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          className="min-h-9 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm"
        />
        <button type="button" onClick={apply} className="min-h-9 rounded bg-foreground px-3 text-sm text-background">
          {active ? "Update" : "Add link"}
        </button>
        {active && (
          <button type="button" onClick={onRemove} className="min-h-9 rounded border border-border px-3 text-sm">
            Remove link
          </button>
        )}
        <button type="button" onClick={onCancel} className="min-h-9 px-2 text-sm underline">
          Cancel
        </button>
      </div>
      {problem && (
        <p id={`${id}-problem`} role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}

const svg = "size-4";
const LinkIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={svg} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
  </svg>
);
const ListIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={svg} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);
const NumberedIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={svg} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 14h2l-2 3h2" />
  </svg>
);
const QuoteIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className={svg} fill="currentColor">
    <path d="M7 7h4v4c0 3-1.5 5-4 6l-.5-1c1.4-.8 2.2-2 2.4-3.5H7V7zm8 0h4v4c0 3-1.5 5-4 6l-.5-1c1.4-.8 2.2-2 2.4-3.5H15V7z" />
  </svg>
);
