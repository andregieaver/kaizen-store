"use client";

import dynamic from "next/dynamic";

import { lazyView } from "@/components/lazy/lazy-view";

/**
 * The page builder's settings fields, the terms manager, the custom-fields form and the theme's sections, loaded where they are drawn (bloat
 * review step 2.30, `lazyView()`, D211): a route loads every client component its modules import, so the builder carried them all in its
 * first scripts (`page-builder-fields.tsx` 47 KB with the grid's tiles, `terms.tsx` 50 KB with the term forms, `fields-form.tsx` 32 KB).
 * The server still draws one that is on screen (a content grid's preview on the canvas, the page's categories, its custom fields) and
 * preloads its script; the settings panel's fields are drawn after a press, and `warmBuilderFields()` fetches them when the builder is idle
 * after its first paint, so the panel finds them there. What the canvas and the Theme tab read of the fields' module without the fields
 * (its contexts and helpers) is in `page-builder-fields-base.ts`. The `import()` stays inside `dynamic()`, as Next finds the script to
 * preload by it.
 */
export const SpacingFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.SpacingFields)));
export const ImageFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ImageFields)));
export const ImageLinkFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ImageLinkFields)));
export const SettingsTabs = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.SettingsTabs)));
export const BackgroundFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.BackgroundFields)));
export const RowWidthChoices = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.RowWidthChoices)));
export const RowLayoutFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.RowLayoutFields)));
export const RowColumnFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.RowColumnFields)));
export const RowContentMaxField = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.RowContentMaxField)));
export const SectionStyleField = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.SectionStyleField)));
export const ColumnSizeFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ColumnSizeFields)));
export const BackgroundAtSize = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.BackgroundAtSize)));
export const ColumnLinkFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ColumnLinkFields)));
export const ShapeChoice = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ShapeChoice)));
export const AnchorField = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.AnchorField)));
export const ClassesField = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ClassesField)));
export const NewTabField = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.NewTabField)));
export const NumberField = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.NumberField)));
export const FrameFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.FrameFields)));
export const HeadingFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.HeadingFields)));
export const ButtonFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ButtonFields)));
export const ButtonStyleFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ButtonStyleFields)));
export const GridPreview = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.GridPreview)));
export const ContentGridFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.ContentGridFields)));
export const GridStyleFields = lazyView(dynamic(() => import("../page-builder-fields").then((m) => m.GridStyleFields)));
/** Generic over the part it sets, which `dynamic()` does not keep: the same component's type. */
export const ColumnsFields = lazyView(
  dynamic(() => import("../page-builder-fields").then((m) => m.ColumnsFields)),
) as typeof import("../page-builder-fields").ColumnsFields;

/** An app preview's fields (D916): their own module, so the builder's first scripts do not carry them; drawn when its settings open. */
export const AppPreviewFields = lazyView(dynamic(() => import("../app-preview-fields").then((m) => m.AppPreviewFields)));

export const TermPicker = lazyView(dynamic(() => import("../terms").then((m) => m.TermPicker)));
export const EntityFields = lazyView(dynamic(() => import("../entity-fields").then((m) => m.EntityFields)));
export const ThemeSectionsList = lazyView(dynamic(() => import("../theme-sections-list").then((m) => m.ThemeSectionsList)));

let warmed: Promise<unknown> | null = null;
/** Fetches the settings fields' chunk ahead of a press (once); a failed fetch is forgotten so the press itself asks again. */
export function warmBuilderFields(): void {
  warmed ??= import("../page-builder-fields").catch(() => {
    warmed = null;
  });
}
