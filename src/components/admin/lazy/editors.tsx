"use client";

import dynamic from "next/dynamic";
import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

import { lazyView } from "@/components/lazy/lazy-view";
import type { RichTextDoc } from "@/lib/rich-text-doc";

/**
 * The custom-field card and the rich text editor, loaded only on a screen that draws one (D211, `lazyView()`, bloat review step 0.10): a
 * route loads every client component its server modules import, so an order, a customer, a deal or a product would carry the editor
 * (ProseMirror) in its first scripts even when it has no rich text field to draw. The server still draws them into the page. The `import()`
 * stays inside `dynamic()`, as Next finds the script to preload by it.
 *
 * The page builder and its fields use them too (bloat review step 2.29): the canvas paints before Tiptap is in the browser. The text
 * fields are drawn in the browser only (`ssr: false`), the inline editors only after a press, and `warmEditors()` fetches the four
 * chunks when the builder is idle after its first paint, so a press finds them there.
 */
export const RichTextEditor = lazyView(
  dynamic(() => import("../rich-text-editor").then((m) => m.RichTextEditor)),
  () => <div className="min-h-32 rounded-md border border-line bg-card" aria-hidden />,
);
/** A contract's paragraph or clause as rich text (D695): loaded on a contract's or a template's page only. Until it is there its box shows
 * the block's words as they are (D857), not an empty box. */
export const ContractTextEditor = lazyView(
  dynamic(() => import("../deals/contract-text-editor").then((m) => m.ContractTextEditor)),
  ({ value }: { value: RichTextDoc }) => (
    <div className="min-h-36 whitespace-pre-wrap rounded-md border border-line bg-card px-3 pt-14 pb-2 text-sm leading-relaxed" aria-hidden>
      {wordsOf(value)}
    </div>
  ),
);

/** A document's words, a paragraph a line, for the box held while the editor loads. */
function wordsOf(node: { text?: string; content?: unknown[] }): string {
  if (typeof node.text === "string") return node.text;
  const parts = (node.content ?? []).map((child) => wordsOf(child as { text?: string; content?: unknown[] }));
  return parts.join(node.content?.some((c) => (c as { type?: string }).type === "text") ? "" : "\n");
}
export const EntityFieldsCard = lazyView(dynamic(() => import("../entity-fields-card").then((m) => m.EntityFieldsCard)));

/** A plain field of the settings panel that takes inline markup: drawn in the browser, its place held by a box of its own size. */
export const MarkupInput = dynamic(() => import("../markup-input").then((m) => m.MarkupInput), {
  ssr: false,
  loading: () => <div className="min-h-10 rounded-md border border-line bg-card" aria-busy />,
});
/**
 * The canvas's inline editors, opened by a press. Until their chunk is there the block keeps what it shows (`fallback`, the block's own view):
 * a fallback of nothing took the heading out of the page for a moment, the block shrank, and the second press of a double press (the block's
 * settings) landed beside it and opened nothing (`e2e/signed-in/text-styles.spec.ts`, found in bloat review step 2.29). `React.lazy` rather
 * than `next/dynamic`: these are never drawn on the server (a press starts them), so there is no script to preload by the `import()`.
 */
const loadInlineMarkup = () => import("@/components/inline-edit/markup-editor").then((m) => ({ default: m.InlineMarkupEditor }));
const loadInlineRich = () => import("@/components/inline-edit/rich-text-inline").then((m) => ({ default: m.InlineRichEditor }));
const InlineMarkupEditorLoaded = lazy(loadInlineMarkup);
const InlineRichEditorLoaded = lazy(loadInlineRich);

export function InlineMarkupEditor({ fallback, ...props }: ComponentProps<typeof InlineMarkupEditorLoaded> & { fallback: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <InlineMarkupEditorLoaded {...props} />
    </Suspense>
  );
}
export function InlineRichEditor({ fallback, ...props }: ComponentProps<typeof InlineRichEditorLoaded> & { fallback: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <InlineRichEditorLoaded {...props} />
    </Suspense>
  );
}

let warmed: Promise<unknown> | null = null;
/** Fetches the four editors' chunks ahead of a press (once); a failed fetch is forgotten so the press itself asks again. */
export function warmEditors(): void {
  warmed ??= Promise.all([
    import("../rich-text-editor"),
    import("../markup-input"),
    loadInlineMarkup(),
    loadInlineRich(),
  ]).catch(() => {
    warmed = null;
  });
}
