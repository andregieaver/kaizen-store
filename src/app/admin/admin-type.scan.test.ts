import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The admin's pages in the style's type and shapes (docs/admin-style.md 5.1, 5.6, section 8): hierarchy is size and colour, never
 * weight, so no 600 or 700; a page's title is the display size; the main action is a pill. Where a store's own look or a printed
 * document is drawn (the builder's stand-ins, the theme editor's preview, previews of a store's pages, packing slips, the print
 * routes), the weights are theirs and are left alone. Colours are the scheme's roles (D223): no older token name and no fixed palette
 * colour, except where a colour is someone else's on purpose (the builder's resize handles, carriers' marks, the search engine's
 * preview).
 */

const ROOT = join(__dirname, "../../..");
const DIRS = ["src/app/admin", "src/components/admin"];
const THEIRS = ["(print)", "packing-slip", "document-page", "pages/drawing.tsx", "design-profiles/[presetId]/preview", "replica/", "page-builder.tsx", "theme-editor.tsx"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Their colours are someone else's on purpose. */
const OWN_COLOURS = ["row-resize.tsx", "integration-mark.tsx", "seo-fields.tsx", "scheme-preview.tsx"];

const admin = DIRS.flatMap((d) => files(join(ROOT, d)))
  .map((path) => relative(ROOT, path))
  .filter((path) => !THEIRS.some((part) => path.includes(part)));

describe("the admin's type and shapes", () => {
  it("found the admin's files", () => {
    expect(admin.length).toBeGreaterThan(300);
  });

  it.each(admin)("%s uses no semibold or bold weight", (path) => {
    expect(readFileSync(join(ROOT, path), "utf8")).not.toMatch(/(?<![\w-])font-(semibold|bold|extrabold|black)(?![\w-])/);
  });

  it("gives every page title the display size, not the old one", () => {
    const old = admin.filter((path) => /<h1 className="[^"]*text-2xl font-(semibold|medium)/.test(readFileSync(join(ROOT, path), "utf8")));
    expect(old).toEqual([]);
  });

  it("draws the main action as a pill wherever it names a corner", () => {
    const square = admin.filter((path) =>
      [...readFileSync(join(ROOT, path), "utf8").matchAll(/className="([^"]*)"/g)].some(([, cls]) => /\bbg-foreground\b/.test(cls) && /\btext-background\b/.test(cls) && /(?<![\w-])rounded-md(?![\w-])/.test(cls)),
    );
    expect(square).toEqual([]);
  });

  it.each(admin.filter((path) => !OWN_COLOURS.some((part) => path.includes(part))))("%s draws in the scheme's roles only", (path) => {
    const source = readFileSync(join(ROOT, path), "utf8");
    // The older names (`admin.css` still maps them for what draws a store's look).
    expect(source).not.toMatch(/(?<![\w-])(?:[\w\-[\]=&]+:)*(?:bg|text|border|divide|ring|outline|accent)-(?:background|surface|border|foreground)(?![\w-])/);
    // Fixed palette colours: a signal role says what the colour means, and follows the scheme into dark.
    expect(source).not.toMatch(/(?<![\w-])(?:[\w\-[\]=&]+:)*(?:text|bg|border|ring|divide|outline|fill|stroke|decoration)-(?:red|rose|amber|yellow|orange|green|emerald|teal|lime|blue|sky|indigo|violet|purple|gray|neutral|zinc|slate|stone)-\d{2,3}(?![\w-])/);
  });
});
