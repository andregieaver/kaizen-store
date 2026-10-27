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
const THEIRS = ["(print)", "packing-slip", "document-page", "pages/drawing.tsx", "account/themes/[presetId]/preview", "replica/", "account/look/", "account/share/", "install-preview-view.tsx", "page-builder.tsx", "theme-editor.tsx"];

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

  it("draws every button and button-like link as a pill (D231)", () => {
    const control = /<(?:button|Link|a)\b[^<>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
    const squareControl = (cls: string) =>
      /(?<![\w-])rounded-md(?![\w-])/.test(cls) && /(?<![\w-])(min-h-(9|10|11)|h-(9|10|11)|py-2)(?![\w-])/.test(cls) && /(?<![\w-])(bg-brand|border)(?![\w-])/.test(cls);
    // A button or a link drawn as one is a pill whatever its kind (docs/admin-style.md 5.2); a shared constant of a filled or bordered one too.
    const square = (cls: string, onControl = true) => (onControl ? /(?<![\w:-])rounded-md(?![\w-])/.test(cls) : squareControl(cls));
    const own = admin.filter((path) => {
      const source = readFileSync(join(ROOT, path), "utf8");
      const constants = [...source.matchAll(/const \w*(?:[Bb]utton|[Bb]tn|primary|secondary|small|action|Action|Primary|Secondary|Small)\w* = \s*"([^"]*)"/g)].map((m) => m[1]);
      return [...source.matchAll(control)].some((m) => square(m[1] ?? m[2])) || constants.some((cls) => square(cls, false));
    });
    expect(own).toEqual([]);
  });

  it("writes a section's title, a figure and an eyebrow in the type scale (D231)", () => {
    const own = admin.filter((path) => {
      const source = readFileSync(join(ROOT, path), "utf8");
      return (
        /<h2\b[^<>]*className="(?![^"]*sr-only)[^"]*(?<![\w-])font-medium(?![\w-])/.test(source) ||
        /(?<![\w-])text-2xl font-medium(?![\w-])/.test(source) ||
        /text-xs font-medium tracking-wide text-muted uppercase/.test(source)
      );
    });
    expect(own).toEqual([]);
  });

  it("draws a card as Card or CARD_CLASS, never as a bordered box of its own", () => {
    const own = admin.filter((path) => /\brounded-card border border-line bg-card\b/.test(readFileSync(join(ROOT, path), "utf8")));
    expect(own).toEqual([]);
  });

  it.each(admin.filter((path) => !OWN_COLOURS.some((part) => path.includes(part))))("%s draws in the scheme's roles only", (path) => {
    const source = readFileSync(join(ROOT, path), "utf8");
    // The older names (`admin.css` still maps them for what draws a store's look).
    expect(source).not.toMatch(/(?<![\w-])(?:[\w\-[\]=&]+:)*(?:bg|text|border|divide|ring|outline|accent)-(?:background|surface|border|foreground)(?![\w-])/);
    // Fixed palette colours: a signal role says what the colour means, and follows the scheme into dark.
    expect(source).not.toMatch(/(?<![\w-])(?:[\w\-[\]=&]+:)*(?:text|bg|border|ring|divide|outline|fill|stroke|decoration)-(?:red|rose|amber|yellow|orange|green|emerald|teal|lime|blue|sky|indigo|violet|purple|gray|neutral|zinc|slate|stone)-\d{2,3}(?![\w-])/);
  });

  it("draws every signed-out page in the focus layout, not a page frame of its own", () => {
    const signedOut = admin.filter((path) => path.startsWith("src/app/admin/") && !path.startsWith("src/app/admin/(gated)") && path.endsWith("/page.tsx"));
    expect(signedOut.length).toBeGreaterThanOrEqual(6);
    const own = signedOut.filter((path) => {
      const source = readFileSync(join(ROOT, path), "utf8");
      return !source.includes("<FocusFrame") || /<main[\s>]|<h1[\s>]/.test(source);
    });
    expect(own).toEqual([]);
  });

  it("titles every signed-in page with PageHeader, not an h1 of its own", () => {
    // The tools and notices that draw a compact title of their own on purpose, and pages titled for screen readers only.
    const COMPACT = ["ui/focus-frame.tsx", "setup-frame.tsx", "support/inbox.tsx", "product-editor.tsx", "feature-off.tsx", "feature-off-text.tsx", "work/report-print.tsx", "(gated)/error.tsx"];
    const own = admin
      .filter((path) => (path.startsWith("src/app/admin/(gated)") || path.startsWith("src/components/admin")) && !COMPACT.some((part) => path.includes(part)))
      .filter((path) => /<h1(?![^>]*className="sr-only")[\s>]/.test(readFileSync(join(ROOT, path), "utf8")));
    expect(own).toEqual([]);
  });
});
