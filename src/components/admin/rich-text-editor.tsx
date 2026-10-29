"use client";

import { Mark } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { useId, useState, type ReactNode } from "react";

import { HEX6, colourCss, isOpacity } from "@/lib/colour";
import { formatHtml, htmlLeftOut } from "@/lib/rich-html";
import { SLUG_SHAPE, slugOfClass, textStyleClass } from "@/lib/text-styles";
import { isLinkAddress, type RichTextDoc } from "@/lib/page-content";

import { fillWords } from "@/lib/admin-fill";
import { useAdminText } from "./admin-text";
import { ColorField } from "./colour-field";
import { StyleMenu, useTextStyles } from "./text-styles";


/**
 * A rich-text block in the page editor (D42): Tiptap (ProseMirror) in the
 * browser, limited to what pages show: headings 2–4, paragraphs, bold,
 * italic, underline, links, a colour (D180), lists, quotes and lines. It
 * writes JSON, which the server checks again and the site renders as
 * elements, never as HTML.
 */

/**
 * A colour on words (D180): Tiptap's `textStyle` mark with `color` (`#rrggbb`) and an optional `opacity` (0–100), as
 * `cleanRichText()` keeps it. Only its own spans are read back (`data-color`), so pasted styles never come in.
 */
const TextColour = Mark.create({
  name: "textStyle",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const color = element.getAttribute("data-color");
          return color && HEX6.test(color) ? color.toLowerCase() : null;
        },
        renderHTML: () => ({}),
      },
      opacity: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute("data-opacity");
          return value !== null && isOpacity(Number(value)) ? Number(value) : null;
        },
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-color]" }];
  },
  renderHTML({ mark }) {
    const color = typeof mark.attrs.color === "string" && HEX6.test(mark.attrs.color) ? mark.attrs.color : null;
    const opacity = isOpacity(mark.attrs.opacity) ? mark.attrs.opacity : null;
    return ["span", { ...(color && { "data-color": color, style: `color: ${colourCss(color, opacity)}` }), ...(opacity !== null && { "data-opacity": String(opacity) }) }, 0];
  },
});

/**
 * A text style on words (D393): the mark `textClass` with the style's slug, drawn as `<span class="ts-{slug}">`. Only a style's class is
 * read back from HTML (a paste, the HTML view), never another class; it reads alongside a colour's span (`consuming: false`).
 */
const TextClass = Mark.create({
  name: "textClass",
  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element: HTMLElement) => styleSlugOf(element),
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span", consuming: false, getAttrs: (element: HTMLElement) => (styleSlugOf(element) ? null : false) }];
  },
  renderHTML({ mark }) {
    const name = typeof mark.attrs.name === "string" && SLUG_SHAPE.test(mark.attrs.name) ? mark.attrs.name : null;
    return ["span", name ? { class: textStyleClass(name) } : {}, 0];
  },
});

function styleSlugOf(element: HTMLElement): string | null {
  for (const name of Array.from(element.classList)) {
    const slug = slugOfClass(name);
    if (slug) return slug;
  }
  return null;
}

/** What a rich text can hold, for the editor in the page builder's panel and the one that edits in place (D191). */
export const RICH_TEXT_EXTENSIONS = [
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
  TextColour,
  TextClass,
];

/** What a person types as a link: "kaizen.no" means https://kaizen.no. */
export function linkFromInput(value: string): string {
  const text = value.trim();
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)) return `https://${text}`;
  if (/^[^@\s/:]+@[^@\s]+\.[^@\s]+$/.test(text)) return `mailto:${text}`;
  return text;
}

const tool =
  "flex min-h-9 min-w-9 items-center justify-center rounded px-2 text-sm hover:bg-sunken aria-pressed:bg-inverse aria-pressed:text-inverse-ink disabled:opacity-40";

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
    extensions: RICH_TEXT_EXTENSIONS,
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

  const w = useAdminText("builder").textStyles;
  const styles = useTextStyles();
  // The HTML view (D393): the editor's HTML to edit as text, read back into the editor's parts on Visual, naming what was left out.
  const [html, setHtml] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const htmlId = useId();
  const toVisual = () => {
    if (!editor || html === null) return;
    const known = new Set((styles?.styles ?? []).map((style) => style.slug));
    setLeftOut(htmlLeftOut(html, known));
    editor.commands.setContent(html, { emitUpdate: true });
    setHtml(null);
  };
  return (
    <div className="rounded-md border border-line bg-card focus-within:border-brand">
      <div role="group" aria-label={w.html} className="flex justify-end gap-1 border-b border-line px-1 py-1">
        {(["visual", "html"] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={(html !== null) === (view === "html")}
            disabled={!editor}
            onClick={() => {
              if (view === "html" && editor && html === null) {
                setLeftOut([]);
                setHtml(formatHtml(editor.getHTML()));
              } else if (view === "visual") toVisual();
            }}
            className="min-h-8 rounded px-2 text-caption text-ink-2 hover:bg-sunken aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
          >
            {view === "visual" ? w.visual : w.html}
          </button>
        ))}
      </div>
      {/* The editor stays mounted while the HTML is edited, only hidden. */}
      <div hidden={html !== null}>
        {editor ? <RichTextToolbar editor={editor} label={label} /> : <div className="h-11 border-b border-line" />}
        <EditorContent editor={editor} />
      </div>
      {html !== null && (
        <div className="flex flex-col gap-2 p-2">
          <label htmlFor={htmlId} className="sr-only">
            {fillWords(w.htmlLabel, { label })}
          </label>
          <textarea
            id={htmlId}
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            rows={10}
            spellCheck={false}
            className="min-h-40 w-full rounded border border-line bg-card px-3 py-2 font-mono text-caption"
          />
          <p className="text-caption text-muted">{w.htmlHint}</p>
        </div>
      )}
      {leftOut.length > 0 && (
        <p role="status" className="border-t border-line px-3 py-2 text-caption text-warning-text">
          {fillWords(w.leftOut, { list: leftOut.join(", ") })}
        </p>
      )}
    </div>
  );
}

/** The formatting bar over a rich text: in the panel's editor, and floating over the text edited in place (D191). */
export function RichTextToolbar({ editor, label }: { editor: Editor; label: string }) {
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
      color: (e.getAttributes("textStyle").color as string | null | undefined) ?? undefined,
      textClass: (e.getAttributes("textClass").name as string | null | undefined) ?? null,
      selected: !e.state.selection.empty,
      opacity: (e.getAttributes("textStyle").opacity as number | null | undefined) ?? undefined,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linking, setLinking] = useState(false);
  const [colouring, setColouring] = useState(false);
  const chain = () => editor.chain().focus();
  const w = useAdminText("builder").richText;
  /** Colours the selected words, or the coloured words the cursor is in (without taking the focus from the colour field). */
  const colour = (attrs: { color: string; opacity: number | null } | null) => {
    let next = editor.chain();
    if (editor.state.selection.empty && state.color) next = next.extendMarkRange("textStyle");
    (attrs ? next.setMark("textStyle", attrs) : next.unsetMark("textStyle")).run();
  };

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
    <div className="sticky top-0 z-10 rounded-t-md border-b border-line bg-card">
      <div role="toolbar" aria-label={fillWords(w.toolbar, { label })} className="flex flex-wrap items-center gap-0.5 p-1">
        <label className="sr-only" htmlFor={`${editor.instanceId}-style`}>
          {w.style}
        </label>
        <select
          id={`${editor.instanceId}-style`}
          value={state.style}
          onChange={(event) => {
            const style = event.target.value;
            if (style === "p") chain().setParagraph().run();
            else chain().setHeading({ level: Number(style.slice(1)) as 2 | 3 | 4 }).run();
          }}
          className="min-h-9 rounded border border-line bg-card px-2 text-sm"
        >
          <option value="p">{w.paragraph}</option>
          <option value="h2">{w.heading}</option>
          <option value="h3">{w.subheading}</option>
          <option value="h4">{w.smallHeading}</option>
        </select>
        <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        {button(w.bold, state.bold, () => chain().toggleBold().run(), <strong>B</strong>)}
        {button(w.italic, state.italic, () => chain().toggleItalic().run(), <em className="font-serif">I</em>)}
        {button(w.underline, state.underline, () => chain().toggleUnderline().run(), <u>U</u>)}
        {button(w.link, state.link || linking, () => setLinking((open) => !open), <LinkIcon />)}
        {button(
          w.colour,
          Boolean(state.color) || colouring,
          () => setColouring((open) => !open),
          <span aria-hidden className="flex flex-col items-center leading-none">
            A
            <span className="mt-0.5 h-1 w-4 rounded-sm border border-line" style={state.color ? { backgroundColor: colourCss(state.color, state.opacity) } : undefined} />
          </span>,
        )}
        <StyleMenu
          active={state.textClass}
          hasSelection={state.selected}
          apply={(slug) => {
            // The selected words, or the styled words the cursor is in.
            let next = chain();
            if (editor.state.selection.empty && state.textClass) next = next.extendMarkRange("textClass");
            (slug ? next.setMark("textClass", { name: slug }) : next.unsetMark("textClass")).run();
          }}
        />
        <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        {button(w.bullets, state.bulletList, () => chain().toggleBulletList().run(), <ListIcon />)}
        {button(w.numbers, state.orderedList, () => chain().toggleOrderedList().run(), <NumberedIcon />)}
        {button(w.quote, state.blockquote, () => chain().toggleBlockquote().run(), <QuoteIcon />)}
        {button(w.line, undefined, () => chain().setHorizontalRule().run(), <span aria-hidden>―</span>)}
        <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        {button(w.undo, undefined, () => chain().undo().run(), <span aria-hidden>↶</span>, !state.canUndo)}
        {button(w.redo, undefined, () => chain().redo().run(), <span aria-hidden>↷</span>, !state.canRedo)}
      </div>
      {colouring && (
        <div className="flex flex-wrap items-end gap-3 border-t border-line p-2">
          <ColorField
            label={w.colour}
            value={state.color}
            placeholder={w.ownColour}
            onChange={(color) => colour({ color, opacity: state.opacity ?? null })}
            onClear={() => colour(null)}
            opacity={{ value: state.opacity, onChange: (opacity) => state.color && colour({ color: state.color, opacity: opacity ?? null }) }}
          />
          <button type="button" onClick={() => setColouring(false)} className="min-h-9 px-2 text-sm underline">
            {w.done}
          </button>
        </div>
      )}
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
  const w = useAdminText("builder").richText;
  const id = useId();
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const apply = () => {
    const href = linkFromInput(value);
    if (!isLinkAddress(href)) {
      setProblem(w.badLink);
      return;
    }
    onApply(href);
  };
  return (
    <div className="flex flex-col gap-2 border-t border-line p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {w.linkTo}
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
          placeholder={w.linkPlaceholder}
          inputMode="url"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          className="min-h-9 min-w-0 flex-1 rounded border border-line bg-card px-2 text-sm"
        />
        <button type="button" onClick={apply} className="min-h-9 rounded bg-brand px-3 text-sm text-brand-ink">
          {active ? w.update : w.addLink}
        </button>
        {active && (
          <button type="button" onClick={onRemove} className="min-h-9 rounded border border-line px-3 text-sm">
            {w.removeLink}
          </button>
        )}
        <button type="button" onClick={onCancel} className="min-h-9 px-2 text-sm underline">
          {w.cancel}
        </button>
      </div>
      {problem && (
        <p id={`${id}-problem`} role="alert" className="text-sm text-danger-text">
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
