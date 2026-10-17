import type { PackPicture } from "../content-pack-pages";
import type { PackPhoto } from "../content-packs";
import { rem, lines, em } from "../theme-kit";

/**
 * The blocks a signature theme's designed pages and layouts are written with (`docs/signature-themes.md`): rich text, headings, buttons,
 * pictures, product grids and the site's and product page's own parts, each with a fresh id. Every theme in `src/lib/signature/` builds its
 * rows from these, so a page reads as the builder would have saved it (`pageInput` checks it on save). Pure.
 */

export const uuid = () => globalThis.crypto.randomUUID();

/** A rich text paragraph node. */
export const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

/** A typography look for a kind of text (`Typography`, D179): family, weight, size, line height, spacing, case, colour. */
export type Look = Record<string, unknown>;

/** A rich text block of paragraphs, with its class and the look of its text. */
export const text = (texts: string[], className?: string, look?: Look) => ({
  id: uuid(),
  type: "richText",
  doc: { type: "doc", content: texts.map(paragraph) },
  ...(className && { className }),
  ...(look && { typography: { text: look } }),
});

/** A heading at its level, with its class and the look of its words. */
export const heading = (words: string, level: number, className?: string, look?: Look) => ({
  id: uuid(),
  type: "heading",
  text: words,
  level,
  ...(className && { className }),
  ...(look && { typography: { text: look } }),
});

/** A button: filled, outline or text, pill-shaped unless said (`shape` in `extra`). */
export const button = (label: string, href: string, variant: "filled" | "outline" | "text" = "filled", extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  type: "button",
  label,
  href,
  variant,
  shape: "pill",
  ...extra,
});

/** Two buttons side by side, the first filled, the second outlined. */
export const twoButtons = (first: [string, string], second: [string, string], extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  type: "dualButton",
  first: { label: first[0], href: first[1], variant: "filled" },
  second: { label: second[0], href: second[1], variant: "outline" },
  size: "lg",
  shape: "pill",
  gap: 14,
  ...extra,
});

/** A picture block with no caption or link. */
export const image = (picture: PackPicture | null, className?: string, extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  type: "image",
  image: picture ? { ...picture } : null,
  caption: "",
  href: "",
  ...(className && { className }),
  ...extra,
});

/** A row's or column's background picture, under a see-through colour (`overlay` percent). */
export const photo = (picture: PackPicture | null, overlay = 35, color = "#05060f") =>
  picture ? { type: "image", image: { url: picture.url, width: picture.width, height: picture.height }, overlay: { color, opacity: overlay } } : undefined;

/** A grid of the store's products, oldest first (the pack's order). */
export const productGrid = (limit: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  type: "contentGrid",
  source: { type: "products" },
  categories: [],
  tags: [],
  sort: "oldest",
  limit,
  columns: { mobile: 2, tablet: 2, desktop: 4 },
  show: { image: true, heading: true, excerpt: false, price: true, button: false },
  buttonLabel: "",
  emptyText: "",
  headingLevel: 3,
  excerptLines: 3,
  gap: 28,
  ...extra,
});

/** A list of lines, each after an icon (`ICONS`). */
export const iconList = (items: [icon: string, words: string][], extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  type: "iconList",
  items: items.map(([icon, words]) => ({ id: uuid(), icon, text: words, href: "" })),
  ...extra,
});

/** A site part (header and footer), by its fixed id. */
export const site = (id: string, part: string, extra: Record<string, unknown> = {}) => ({ id, type: "site", part, ...extra });

/** A product page part, by its fixed id. */
export const product = (id: string, part: string, extra: Record<string, unknown> = {}) => ({ id, type: "product", part, ...extra });

/** A photograph the picture model makes for a pack's slot (D270): its shape, its alt text and the photographer's brief. */
export const shot = (shape: PackPhoto["shape"], alt: string, brief: string): PackPhoto => ({ brief, shape, alt });

/** Hidden on phones (Small). */
export const phonesHidden = { visibility: { hideAt: ["sm"] } };

/** The small line in capitals over a heading. */
export const EYEBROW: Look = { size: rem(0.75), lineHeight: lines(1.4), letterSpacing: em(0.3), transform: "uppercase", weight: 600 };
