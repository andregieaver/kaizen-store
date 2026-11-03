import { afterEach, describe, expect, it, vi } from "vitest";

import { compileDocs, type DocSource } from "./docs-content";
import { isSearchShortcut } from "./docs-search";
import { absoluteLinks, changelogMarkdown, docPageMarkdown, docsLlms, docsLlmsFull, docsRobots, docsSitemap, formatDocDate } from "./docs-text";

afterEach(() => vi.unstubAllEnvs());

const front = (fields: Record<string, string>) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
const meta = { kind: "how-to", areas: "[products]", order: "10", checked: "2026-11-03", sources: "[]" };

const SOURCES: DocSource[] = [
  { file: "content/docs/owners/start/_section.en.md", text: front({ title: "Getting started", order: "10" }) },
  { file: "content/docs/owners/start/_section.nb.md", text: front({ title: "Kom i gang", order: "10" }) },
  {
    file: "content/docs/owners/start/one.en.md",
    text: `${front({ title: "One", summary: "The first.", track: "owners", section: "start", ...meta })}\n## Go {#go}\n\nSee [two](/docs/owners/start/two#more), [here](#go), [status](/status) and [x](https://x.example).\n\n\`\`\`bash\n# [not](/docs/a) a link\n\`\`\`\n\nAnd \`[code](/docs/b)\`.`,
  },
  { file: "content/docs/owners/start/one.nb.md", text: `${front({ title: "En", summary: "Den første.", track: "owners", section: "start", ...meta })}\n## Gå\n\nSe [to](/docs/owners/start/two).` },
  { file: "content/docs/owners/start/two.en.md", text: `${front({ title: "Two", summary: "The second.", track: "owners", section: "start", ...meta, order: "20" })}\n## More\n\nText.` },
  { file: "content/docs/developers/overview/_section.en.md", text: front({ title: "Overview", order: "10" }) },
  { file: "content/docs/developers/overview/intro.en.md", text: `${front({ title: "Intro", summary: "APIs.", track: "developers", section: "overview", ...meta, areas: "[admin-api]" })}\n## APIs\n\nWords.` },
  { file: "content/docs/developers/changelog.md", text: "## 1.0\n\nFirst. See [intro](/docs/developers/overview/intro)." },
  { file: "content/docs/missing-nb.json", text: '{"owners/start/two": "The Norwegian page waits for its review."}' },
];

const compiled = compileDocs(SOURCES);
const index = compiled.index;
const page = (path: string, lang: "en" | "nb") => index.pages.find((p) => p.path === path && p.lang === lang)!;

describe("the docs as plain text (D442)", () => {
  it("compiles the fixture", () => {
    expect(compiled.problems).toEqual([]);
  });

  it("gives each page as Markdown with full links, code left alone, in the page's language where its target has one", () => {
    const md = docPageMarkdown(page("owners/start/one", "en"), index);
    expect(md).toMatch(/^# One\n\n> The first\.\n\n## Go \{#go\}/);
    expect(md).toContain("[two](http://localhost:3000/docs/owners/start/two#more)");
    expect(md).toContain("[here](http://localhost:3000/docs/owners/start/one#go)");
    expect(md).toContain("[status](http://localhost:3000/status)");
    expect(md).toContain("[x](https://x.example)");
    expect(md).toContain("# [not](/docs/a) a link");
    expect(md).toContain("`[code](/docs/b)`");
    expect(md).toMatch(/http:\/\/localhost:3000\/docs\/owners\/start\/one · 2026-11-03\n$/);
    // From Norwegian, a page without its Norwegian twin is linked in English.
    expect(docPageMarkdown(page("owners/start/one", "nb"), index)).toContain("[to](http://localhost:3000/docs/owners/start/two)");
    expect(absoluteLinks("[a](/docs)", index, "nb", "x")).toBe("[a](http://localhost:3000/no/docs)");
  });

  it("uses the docs' own host for their addresses once they have one", () => {
    vi.stubEnv("NEXT_PUBLIC_DOCS_HOST", "docs.kaizenaflow.com");
    vi.stubEnv("SITE_URL", "https://kaizenaflow.com");
    const md = docPageMarkdown(page("owners/start/one", "en"), index);
    expect(md).toContain("[two](https://docs.kaizenaflow.com/owners/start/two#more)");
    expect(md).toContain("[status](https://kaizenaflow.com/status)");
    expect(docsRobots()).toBe("User-agent: *\nAllow: /\nDisallow: /search\nDisallow: /no/search\n\nSitemap: https://docs.kaizenaflow.com/sitemap.xml\n");
    expect(docsSitemap(index)).toContain("<loc>https://docs.kaizenaflow.com/no/owners/start/one</loc>");
  });

  it("has no rules for crawlers of its own without a host", () => {
    expect(docsRobots()).toBeNull();
  });

  it("writes llms.txt with each page's Markdown address and summary, by track and section, and the Norwegian pages", () => {
    const text = docsLlms(index, { title: "Kaizena Flow Docs", description: "How to.", tracks: { owners: "Store owners", developers: "Developers" }, changelog: "Changelog" });
    expect(text).toContain("# Kaizena Flow Docs\n\n> How to.");
    expect(text).toContain("## Store owners: Getting started\n\n- [One](http://localhost:3000/docs/owners/start/one.md): The first.\n- [Two](http://localhost:3000/docs/owners/start/two.md): The second.");
    expect(text).toContain("## Developers: Overview\n\n- [Intro](http://localhost:3000/docs/developers/overview/intro.md): APIs.");
    expect(text).toContain("- [Changelog](http://localhost:3000/docs/changelog.md)");
    expect(text).toContain("## Norsk\n\n- [En](http://localhost:3000/no/docs/owners/start/one.md): Den første.");
    expect(text).toContain("- [Every page in full](http://localhost:3000/docs/llms-full.txt)");
  });

  it("writes llms-full.txt with every page in full, each a level down", () => {
    const text = docsLlmsFull(index, { title: "Kaizena Flow Docs", description: "How to.", changelog: "Changelog" });
    expect(text.startsWith("# Kaizena Flow Docs\n\n> How to.\n\n## One\n\n> The first.\n\n### Go")).toBe(true);
    expect(text).toContain("## Intro");
    expect(text).toContain("## En");
    expect(text).toContain("## Changelog\n\n### 1.0");
    expect(changelogMarkdown(index.changelog!, index, "Changelog")).toContain("[intro](http://localhost:3000/docs/developers/overview/intro)");
  });

  it("lists every address in its sitemap, with the other language of an owners' page", () => {
    const xml = docsSitemap(index);
    expect(xml).toContain("<url><loc>http://localhost:3000/docs</loc>");
    expect(xml).toContain(
      '<url><loc>http://localhost:3000/docs/owners/start/one</loc><lastmod>2026-11-03</lastmod><xhtml:link rel="alternate" hreflang="en" href="http://localhost:3000/docs/owners/start/one"/><xhtml:link rel="alternate" hreflang="nb" href="http://localhost:3000/no/docs/owners/start/one"/><xhtml:link rel="alternate" hreflang="x-default" href="http://localhost:3000/docs/owners/start/one"/></url>',
    );
    expect(xml).toContain("<url><loc>http://localhost:3000/docs/owners/start/two</loc><lastmod>2026-11-03</lastmod></url>");
    expect(xml).toContain("<loc>http://localhost:3000/docs/changelog</loc>");
    expect(xml).not.toContain("/no/docs/developers");
  });

  it("writes a day in each language's words", () => {
    expect(formatDocDate("2026-11-03", "en-GB")).toBe("3 November 2026");
    expect(formatDocDate("2026-11-03", "nb-NO")).toBe("3. november 2026");
  });

  it("knows the search's shortcut: ⌘K or Ctrl+K, or / outside a field", () => {
    const key = (key: string, more: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...more });
    expect(isSearchShortcut(key("k", { metaKey: true }), false)).toBe(true);
    expect(isSearchShortcut(key("K", { ctrlKey: true }), true)).toBe(true);
    expect(isSearchShortcut(key("k", { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSearchShortcut(key("k", { metaKey: true, altKey: true }), false)).toBe(false);
    expect(isSearchShortcut(key("/"), false)).toBe(true);
    expect(isSearchShortcut(key("/"), true)).toBe(false);
    expect(isSearchShortcut(key("k"), false)).toBe(false);
  });
});
