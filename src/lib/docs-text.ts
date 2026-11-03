/**
 * The docs as plain text (wave 14 unit E1, D442): each page's Markdown (`….md`), `llms.txt` and `llms-full.txt` for AI tools, the docs'
 * sitemap and their host's rules for crawlers. Pure: the routes hand over the compiled index (`src/server/docs.ts`). Every address in them is
 * full, as an AI tool or a crawler reads the text away from the page.
 */

import { DOC_TRACKS, docLinkLang, docsPaths, docsTree, trackIn, type DocChangelog, type DocLang, type DocPage, type DocRefPage, type DocsIndex } from "./docs-content";
import { docsOrigin, docsUrl } from "./docs-host";
import { PLATFORM_LANG_FACTS } from "./platform-lang";
import { renderLlms } from "./seo";
import { siteUrl } from "./site";

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The links of an article's Markdown made full: `/docs/…` to the docs' own address (in the page's language where the target has it),
 * `#a-heading` to the page's own, any other `/…` to Kaizena Flow's site. Code blocks and code spans are left as written.
 */
export function absoluteLinks(markdown: string, index: DocsIndex, lang: DocLang, own: string): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      // Outside code spans only: the line split on backticks, every other part code.
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(/\]\((\/[^)\s]*|#[^)\s]*)\)/g, (_, target: string) => `](${fullAddress(target, index, lang, own)})`)))
        .join("");
    })
    .join("\n");
}

function fullAddress(target: string, index: DocsIndex, lang: DocLang, own: string): string {
  if (target.startsWith("#")) return `${own}${target}`;
  const hash = target.indexOf("#");
  const path = hash < 0 ? target : target.slice(0, hash);
  const anchor = hash < 0 ? "" : target.slice(hash);
  if (path === "/docs" || path.startsWith("/docs/")) {
    const sub = path.slice("/docs".length).replace(/^\/|\/$/g, "");
    return `${docsUrl(sub, docLinkLang(index, sub, lang))}${anchor}`;
  }
  return `${siteUrl()}${target}`;
}

/** A page as plain Markdown: its title, its summary as a quote, its body with full links, and where it lives. */
export function docPageMarkdown(page: DocPage, index: DocsIndex): string {
  const url = docsUrl(page.path, page.lang);
  return `# ${page.title}\n\n> ${page.summary}\n\n${absoluteLinks(page.markdown, index, page.lang, url)}\n\n---\n\n${url} · ${page.checked}\n`;
}

/** A page of the generated reference as plain Markdown: its title, its summary as a quote, its body with full links, and what it is made from. */
export function docRefPageMarkdown(page: DocRefPage, index: DocsIndex): string {
  const url = docsUrl(page.path);
  const made = index.reference.version ? `made from the API contract ${index.reference.version}` : "made from the API contract";
  return `# ${page.title}\n\n> ${page.summary}\n\n${absoluteLinks(page.markdown, index, "en", url)}\n\n---\n\n${url} · ${made}\n`;
}

/** The changelog as plain Markdown. */
export function changelogMarkdown(changelog: DocChangelog, index: DocsIndex, title: string): string {
  const url = docsUrl("changelog");
  return `# ${changelog.title ?? title}\n\n${absoluteLinks(changelog.markdown, index, "en", url)}\n\n---\n\n${url}\n`;
}

type TrackNames = Record<(typeof DOC_TRACKS)[number], string>;

/** The reference's groups for `llms.txt`: each group (Admin API, Webhooks, …) with its own page first, then its pages. */
function referenceSections(index: DocsIndex, heading: string) {
  const front = index.reference.pages.find((p) => p.parent === null);
  if (!front) return [];
  const entry = (page: DocRefPage) => ({ title: page.title, url: `${docsUrl(page.path)}.md`, note: page.summary });
  return index.reference.pages
    .filter((p) => p.parent === front.path)
    .map((group) => ({ heading: `${heading}: ${group.title}`, links: [entry(group), ...index.reference.pages.filter((p) => p.parent === group.path).map(entry)] }));
}

/** `llms.txt` (llmstxt.org): the docs' pages by track and section, each with its Markdown address and summary, then the reference's. */
export function docsLlms(index: DocsIndex, words: { title: string; description: string; tracks: TrackNames; changelog: string; reference?: string }): string {
  const sections = DOC_TRACKS.flatMap((track) =>
    docsTree(index, track, "en").map(({ section, pages }) => ({
      heading: `${words.tracks[track]}: ${section.title}`,
      links: pages.map((page) => ({ title: page.title, url: `${docsUrl(page.path)}.md`, note: page.summary })),
    })),
  );
  const norwegian = docsTree(index, "owners", "nb").flatMap(({ pages }) => pages);
  return renderLlms({
    name: words.title,
    summary: words.description,
    sections: [
      ...sections,
      ...referenceSections(index, words.reference ?? "API reference"),
      ...(index.changelog ? [{ heading: words.changelog, links: [{ title: words.changelog, url: `${docsUrl("changelog")}.md` }] }] : []),
      ...(norwegian.length > 0
        ? [{ heading: PLATFORM_LANG_FACTS.nb.name, links: norwegian.map((page) => ({ title: page.title, url: `${docsUrl(page.path, "nb")}.md`, note: page.summary })) }]
        : []),
      { heading: "Optional", links: [{ title: "Every page in full", url: docsUrl("llms-full.txt") }] },
    ],
  });
}

/** A page's Markdown one level down, for `llms-full.txt`: its title a `##`, each heading one deeper (`#####` at most), code left as it is. */
function nested(markdown: string): string {
  let fenced = false;
  return markdown
    .replace(/^# /, "## ")
    .split("\n")
    .map((line, i) => {
      if (/^ {0,3}(`{3,}|~{3,})/.test(line)) fenced = !fenced;
      return i > 0 && !fenced && /^#{2,4} /.test(line) ? `#${line}` : line;
    })
    .join("\n")
    .trim();
}

/** `llms-full.txt`: every page as plain Markdown, English first (the generated reference after the articles), then Norwegian, each with its address. */
export function docsLlmsFull(index: DocsIndex, words: { title: string; description: string; changelog: string }): string {
  const pages = (lang: DocLang) => DOC_TRACKS.filter((track) => trackIn(track, lang)).flatMap((track) => docsTree(index, track, lang).flatMap((e) => e.pages));
  const parts = [`# ${words.title}\n\n> ${words.description}`, ...pages("en").map((page) => nested(docPageMarkdown(page, index)))];
  if (index.changelog) parts.push(nested(changelogMarkdown(index.changelog, index, words.changelog)));
  parts.push(...index.reference.pages.map((page) => nested(docRefPageMarkdown(page, index))));
  parts.push(...pages("nb").map((page) => nested(docPageMarkdown(page, index))));
  return `${parts.join("\n\n")}\n`;
}

/** The docs' sitemap: every address in every language it is written in, a page naming its other language (`hreflang`). */
export function docsSitemap(index: DocsIndex): string {
  const entry = (path: string, lang: DocLang) => {
    const page = index.pages.find((p) => p.path === path && p.lang === lang);
    const twins = path === "" || path.startsWith("owners") ? (["en", "nb"] as const).filter((l) => docsPaths(index, l).includes(path)) : [];
    const links =
      twins.length > 1
        ? [...twins.map((l) => `<xhtml:link rel="alternate" hreflang="${PLATFORM_LANG_FACTS[l].tag}" href="${xml(docsUrl(path, l))}"/>`), `<xhtml:link rel="alternate" hreflang="x-default" href="${xml(docsUrl(path))}"/>`].join("")
        : "";
    return `<url><loc>${xml(docsUrl(path, lang))}</loc>${page ? `<lastmod>${page.checked}</lastmod>` : ""}${links}</url>`;
  };
  const urls = (["en", "nb"] as const).flatMap((lang) => docsPaths(index, lang).map((path) => entry(path, lang)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * The docs' host's rules for crawlers: everything open but the search's result pages (D443: a search is for readers, its pages hold nothing
 * the articles do not), and its sitemap; null while the docs have no host (Kaizena Flow's own apply, and the search page says `noindex`).
 */
export function docsRobots(): string | null {
  const origin = docsOrigin();
  return origin ? `User-agent: *\nAllow: /\nDisallow: /search\nDisallow: /no/search\n\nSitemap: ${origin}/sitemap.xml\n` : null;
}

/** A `YYYY-MM-DD` day in a language's words (3 November 2026, 3. november 2026). */
export function formatDocDate(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}
