import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { compileDocs } from "@/lib/docs-content";
import { parseMarkdown } from "@/lib/docs-markdown";

import { DocsMarkdown, docHrefOf } from "./docs-markdown";

afterEach(() => vi.unstubAllEnvs());

const front = "---\ntitle: T\nsummary: S.\ntrack: owners\nsection: s\nkind: how-to\nareas: [products]\norder: 1\nchecked: 2026-11-03\nsources: []\n---\n";
const { index } = compileDocs([
  { file: "content/docs/owners/s/_section.en.md", text: "---\ntitle: S\norder: 1\n---\n" },
  { file: "content/docs/owners/s/_section.nb.md", text: "---\ntitle: S\norder: 1\n---\n" },
  { file: "content/docs/owners/s/a.en.md", text: `${front}\n## A\n\nx` },
  { file: "content/docs/owners/s/a.nb.md", text: `${front}\n## A\n\nx` },
  { file: "content/docs/owners/s/b.en.md", text: `${front}\n## B\n\nx` },
]);
const CALLOUTS = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };
const draw = (md: string, lang: "en" | "nb" = "en") =>
  renderToStaticMarkup(createElement(DocsMarkdown, { blocks: parseMarkdown(md).blocks, ctx: { index, lang, callouts: CALLOUTS } }));

describe("an article drawn (D442): React elements, never HTML", () => {
  it("draws markup typed in an article as text", () => {
    const html = draw('Hi <script>alert(1)</script> <img src=x onerror="alert(1)"> **<b>bold</b>**\n\n| a |\n|---|\n| <i>x</i> |');
    expect(html).not.toMatch(/<script|<img|<i>|<b>/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("<strong class=\"font-semibold\">&lt;b&gt;bold&lt;/b&gt;</strong>");
  });

  it("never draws a refused link as a link", () => {
    const html = draw("[a](javascript:alert(1)) [b](data:text/html,x) [c](//evil.example) [d](vbscript:x)");
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/javascript:|data:text|vbscript:|evil\.example/);
    expect(html).toContain("a b c d");
  });

  it("links docs pages on whichever host serves them, in the reader's language where the page has it", () => {
    expect(draw("[a](/docs/owners/s/a#a) [b](/docs/owners/s/b) [h](#a)", "nb")).toContain(
      '<a href="/no/docs/owners/s/a#a" class="underline underline-offset-2 hover:no-underline">a</a> <a href="/docs/owners/s/b"',
    );
    vi.stubEnv("NEXT_PUBLIC_DOCS_HOST", "docs.kaizenaflow.com");
    vi.stubEnv("SITE_URL", "https://kaizenaflow.com");
    expect(docHrefOf({ kind: "doc", path: "owners/s/a", anchor: null }, index, "nb")).toBe("/no/owners/s/a");
    expect(docHrefOf({ kind: "doc", path: "", anchor: null }, index, "en")).toBe("/");
    expect(docHrefOf({ kind: "site", path: "/status" }, index, "en")).toBe("https://kaizenaflow.com/status");
    expect(docHrefOf({ kind: "admin", path: "/admin/{store}/products" }, index, "en")).toBe("https://kaizenaflow.com/admin");
    expect(docHrefOf({ kind: "anchor", id: "x" }, index, "en")).toBe("#x");
  });

  it("draws external links without the page's address, and admin links to the admin's front door", () => {
    const html = draw("[x](https://x.example/a?b=1) [p](/admin/{store}/products)");
    expect(html).toContain('<a href="https://x.example/a?b=1" class="underline underline-offset-2 hover:no-underline" rel="noopener noreferrer">x</a>');
    expect(html).toContain('href="/admin" class="underline underline-offset-2 hover:no-underline" data-admin-path="/admin/{store}/products">p</a>');
  });

  it("draws headings with their ids, callouts with their word, code coloured and focusable, tables with column headers", () => {
    const html = draw('## Rate limits\n\n> [!WARNING]\n> Keep it.\n\n```json\n{"a": 1}\n```\n\n| A | B |\n|---|--:|\n| 1 | 2 |');
    expect(html).toContain('<h2 id="rate-limits"');
    expect(html).toMatch(/<div role="note"[^>]*><p class="font-semibold">Warning<\/p><p[^>]*>Keep it\.<\/p><\/div>/);
    expect(html).toMatch(/<pre tabindex="0"[^>]*data-lang="json"><code>\{<span class="[^"]+">&quot;a&quot;<\/span>: <span class="[^"]+">1<\/span>\}<\/code><\/pre>/);
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('style="text-align:right"');
  });
});
