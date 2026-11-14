"use client";

import dynamic from "next/dynamic";

import { lazyView } from "@/components/lazy/lazy-view";

/**
 * The custom-field card and the rich text editor, loaded only on a screen that draws one (D211, `lazyView()`, bloat review step 0.10): a
 * route loads every client component its server modules import, so an order, a customer, a deal or a product would carry the editor
 * (ProseMirror) in its first scripts even when it has no rich text field to draw. The server still draws them into the page. The builder
 * and the block fields import the editor directly: they always draw it. The `import()` stays inside `dynamic()`, as Next finds the script
 * to preload by it.
 */
export const RichTextEditor = lazyView(
  dynamic(() => import("../rich-text-editor").then((m) => m.RichTextEditor)),
  () => <div className="min-h-32 rounded-md border border-line bg-card" aria-hidden />,
);
export const EntityFieldsCard = lazyView(dynamic(() => import("../entity-fields-card").then((m) => m.EntityFieldsCard)));
