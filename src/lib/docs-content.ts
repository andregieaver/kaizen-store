/**
 * The docs as code (wave 14 unit E2, D442): articles are Markdown files in the repository, compiled here into a typed index when the docs are
 * built. Pure: `src/server/docs.ts` reads the files and hands them over; `docs-content.test.ts` compiles every file in CI and fails on any
 * problem this finds.
 *
 * The files, under `content/docs/`:
 *
 * - `{track}/{section}/{slug}.{lang}.md`: an article, with front matter (`docs-front-matter.ts`) and a body in the docs' Markdown
 *   (`docs-markdown.ts`). The owners' track is in English and Norwegian (`en`, `nb`), the developers' in English alone;
 * - `{track}/{section}/_section.{lang}.md`: a section's title (`title`), its order in the track (`order`) and a line about it (`summary`);
 * - `developers/changelog.md`: the developers' changelog (unit A writes it; E4 draws it from the contracts), shown at `/docs/changelog`;
 * - `missing-nb.json`: the owners' pages in English still without their Norwegian page, each with the reason, so a missing one is a decision
 *   and not an oversight.
 *
 * An article's front matter:
 *
 * ```yaml
 * title: Price a product on request
 * summary: Show no price and let shoppers ask for a quote instead.
 * track: owners            # owners | developers (its folder's)
 * section: products        # its folder's
 * kind: how-to             # tutorial | how-to | concept | reference | troubleshooting | changelog
 * areas: [products, orders, quotes]   # DOC_AREAS
 * features: []             # D178 features the page needs, if any
 * plans: []                # plans it is on, if not all
 * admin: /admin/{store}/products/{id} # where in the admin it happens, checked against the admin map
 * order: 40                # its place in its section, then its title
 * checked: 2026-11-03      # when it was last checked against the product
 * sources: [D431, D433]    # the decisions it describes, checked against docs/decisions.md
 * operations: []           # Admin API operations it documents (unit A's ADMIN_API), checked once unit A ships
 * tools: []                # MCP tools it documents, checked against the catalogue once it ships
 * ```
 *
 * The checks that need the rest of the repository (the admin map, the decisions, the site's routes, the pictures, the API's operations, the
 * tools) are asked through `DocsCheckContext`, so this stays pure; one not given is not checked.
 */

import { readFrontMatter, type FrontMatterValue } from "./docs-front-matter";
import { parseMarkdown, type Block, type DocHeading, type DocHref } from "./docs-markdown";

export const DOC_TRACKS = ["owners", "developers"] as const;
export type DocTrack = (typeof DOC_TRACKS)[number];

/** The languages of each track: the owners' in English and Norwegian (D312's `/no/`), the developers' in English alone. */
export const DOC_TRACK_LANGS: Record<DocTrack, readonly DocLang[]> = { owners: ["en", "nb"], developers: ["en"] };
export const DOC_LANGS = ["en", "nb"] as const;
export type DocLang = (typeof DOC_LANGS)[number];

export const DOC_KINDS = ["tutorial", "how-to", "concept", "reference", "troubleshooting", "changelog"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/**
 * What a page is about, for the search's filters (unit E3): a closed list, so the facets stay few and spelled one way. A new area is added
 * here with the page that needs it.
 */
export const DOC_AREAS = [
  "getting-started",
  "setup",
  "plans",
  "billing",
  "products",
  "stock",
  "orders",
  "quotes",
  "returns",
  "payments",
  "shipping",
  "markets",
  "tax",
  "website",
  "themes",
  "marketing",
  "customers",
  "ai",
  "analytics",
  "team",
  "settings",
  "integrations",
  "admin-api",
  "storefront-api",
  "webhooks",
  "mcp",
  "shopping-agents",
  "apps",
  "authentication",
  "errors",
  "rate-limits",
] as const;
export type DocArea = (typeof DOC_AREAS)[number];

/** Where the front page, the tracks and the changelog are, beside the articles (`DocPage.path`). */
export const DOCS_CHANGELOG_PATH = "changelog";

/**
 * Where the top bar's *API reference* leads: the developers' track until the generated reference (unit E4) has its own pages under
 * `reference` (`/reference/…` on the docs' host, already theirs in `docsHostRoutes()`).
 */
export const docsReferencePath = (): string => "developers";

export type { DocHeading };

export type DocPage = {
  track: DocTrack;
  section: string;
  slug: string;
  lang: DocLang;
  /** `owners/getting-started/create-your-store`: the same in every language; `docsPath(path, lang)` is its address. */
  path: string;
  /** The file, from the repository's root. */
  file: string;
  title: string;
  summary: string;
  kind: DocKind;
  areas: DocArea[];
  features: string[];
  plans: string[];
  admin: string | null;
  order: number;
  /** `YYYY-MM-DD`. */
  checked: string;
  sources: string[];
  operations: string[];
  tools: string[];
  blocks: Block[];
  headings: DocHeading[];
  /** The body as written, for the page's Markdown (`….md`) and `llms-full.txt`. */
  markdown: string;
};

export type DocSection = { track: DocTrack; slug: string; lang: DocLang; title: string; summary: string; order: number; file: string };

export type DocChangelog = { title: string | null; blocks: Block[]; headings: DocHeading[]; markdown: string; file: string };

export type DocsIndex = {
  pages: DocPage[];
  sections: DocSection[];
  changelog: DocChangelog | null;
  /** `missing-nb.json`: an owners' page's path to why it has no Norwegian page yet. */
  missingNb: Record<string, string>;
};

export type DocProblem = { file: string; line?: number; message: string };

/** One file as the loader read it: its path from the repository's root (`content/docs/…`) and its text. */
export type DocSource = { file: string; text: string };

/** The rest of the repository, for the checks that need it; a check whose function is missing is not made. */
export type DocsCheckContext = {
  /** Whether a decision (`D431`) has a row in `docs/decisions.md`. */
  decision?: (id: string) => boolean;
  /** Whether an admin address (`/admin/{store}/products/{id}`) is a page of the admin map (D107). */
  adminPath?: (path: string) => boolean;
  /** Whether an address of Kaizena Flow's own site (`/status`, `/sign-up`) is one of its routes. */
  sitePath?: (path: string) => boolean;
  /** Whether a picture (`/kaizen/docs/x.png`) is a file under `public/`. */
  image?: (src: string) => boolean;
  /** Whether a store feature (D178) exists. */
  feature?: (id: string) => boolean;
  /** Whether an Admin API operation (`products.get`) is in unit A's `ADMIN_API`; the hook waits for it. */
  operation?: (name: string) => boolean;
  /** Whether an MCP tool is in the catalogue (unit A's); the hook waits for it. */
  tool?: (name: string) => boolean;
};

export const DOCS_ROOT = "content/docs";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECISION = /^D\d{1,4}$/;
const ARTICLE_FILE = /^content\/docs\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9][a-z0-9-]*|_section)\.([a-z]{2})\.md$/;

const isTrack = (value: string): value is DocTrack => (DOC_TRACKS as readonly string[]).includes(value);
const isLang = (value: string): value is DocLang => (DOC_LANGS as readonly string[]).includes(value);
const isKind = (value: unknown): value is DocKind => typeof value === "string" && (DOC_KINDS as readonly string[]).includes(value);
const isArea = (value: string): value is DocArea => (DOC_AREAS as readonly string[]).includes(value);

/** Whether `YYYY-MM-DD` is a real day. */
export function isDocDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Compiles every file into the index, with every problem found; the index holds only what compiled. */
export function compileDocs(sources: readonly DocSource[], context: DocsCheckContext = {}): { index: DocsIndex; problems: DocProblem[] } {
  const problems: DocProblem[] = [];
  const pages: DocPage[] = [];
  const sections: DocSection[] = [];
  let changelog: (DocChangelog & { links: { href: DocHref; line: number }[] }) | null = null;
  let missingNb: Record<string, string> = {};
  const links: { page: DocPage; href: DocHref; line: number }[] = [];

  for (const source of [...sources].sort((a, b) => a.file.localeCompare(b.file))) {
    const report = (message: string, line?: number) => problems.push({ file: source.file, ...(line !== undefined && { line }), message });
    if (source.file === `${DOCS_ROOT}/missing-nb.json`) {
      missingNb = readMissingNb(source.text, report);
      continue;
    }
    if (source.file === `${DOCS_ROOT}/developers/changelog.md`) {
      changelog = compileChangelog(source, report);
      continue;
    }
    const match = ARTICLE_FILE.exec(source.file);
    if (!match) {
      report("Not where the docs keep their files: content/docs/{track}/{section}/{slug}.{lang}.md, or _section.{lang}.md for a section's title.");
      continue;
    }
    const [, track, section, slug, lang] = match;
    if (!isTrack(track)) {
      report(`Unknown track ${track}: one of ${DOC_TRACKS.join(", ")}.`);
      continue;
    }
    if (!isLang(lang) || !DOC_TRACK_LANGS[track].includes(lang)) {
      report(`The ${track} track is written in ${DOC_TRACK_LANGS[track].join(" and ")}, not ${lang}.`);
      continue;
    }
    if (slug === "_section") {
      const compiled = compileSection(source, track, section, lang, report);
      if (compiled) sections.push(compiled);
      continue;
    }
    const page = compilePage(source, { track, section, slug, lang }, context, report);
    if (!page) continue;
    pages.push(page.page);
    for (const link of page.links) links.push({ page: page.page, ...link });
  }

  // Each page's section has its title in the page's language.
  for (const page of pages) {
    if (!sections.some((s) => s.track === page.track && s.slug === page.section && s.lang === page.lang)) {
      problems.push({ file: page.file, message: `The section ${page.track}/${page.section} has no _section.${page.lang}.md with its title.` });
    }
  }
  for (const section of sections) {
    if (!pages.some((p) => p.track === section.track && p.section === section.slug && p.lang === section.lang)) {
      problems.push({ file: section.file, message: "A section without a page in its language: add one or remove the section." });
    }
  }

  // Links between pages and to headings.
  const log = changelog ? stripLinks(changelog) : null;
  const index: DocsIndex = { pages, sections, changelog: log, missingNb };
  for (const { page, href, line } of links) checkLink(index, page, href, context, (message) => problems.push({ file: page.file, line, message }));
  for (const { href, line } of changelog?.links ?? []) checkLink(index, null, href, context, (message) => problems.push({ file: `${DOCS_ROOT}/developers/changelog.md`, line, message }));

  // The owners' pages in Norwegian, or the reason they are not yet.
  for (const page of pages.filter((p) => p.track === "owners" && p.lang === "en")) {
    const twin = pages.some((p) => p.path === page.path && p.lang === "nb");
    const listed = Object.hasOwn(missingNb, page.path);
    if (!twin && !listed) problems.push({ file: page.file, message: `No Norwegian page (${page.path}.nb.md): write it, or list the page in content/docs/missing-nb.json with the reason.` });
    if (twin && listed) problems.push({ file: `${DOCS_ROOT}/missing-nb.json`, message: `${page.path} has its Norwegian page now: take it off the list.` });
  }
  for (const path of Object.keys(missingNb)) {
    if (!pages.some((p) => p.path === path && p.lang === "en" && p.track === "owners")) {
      problems.push({ file: `${DOCS_ROOT}/missing-nb.json`, message: `${path} is not an owners' page in English.` });
    }
  }
  for (const page of pages.filter((p) => p.lang !== "en")) {
    if (!pages.some((p) => p.path === page.path && p.lang === "en")) problems.push({ file: page.file, message: "A page in Norwegian without its English page." });
  }

  return { index: { pages, sections: sortSections(sections), changelog: log, missingNb }, problems };
}

type Report = (message: string, line?: number) => void;

function readMissingNb(text: string, report: Report): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    report("Not JSON: an object of an owners' page's path to the reason it has no Norwegian page yet.");
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    report("An object of an owners' page's path to the reason it has no Norwegian page yet.");
    return {};
  }
  const out: Record<string, string> = {};
  for (const [path, reason] of Object.entries(value)) {
    if (typeof reason !== "string" || reason.trim().length < 10) report(`${path}: the reason is a sentence.`);
    else out[path] = reason.trim();
  }
  return out;
}

function compileChangelog(source: DocSource, report: Report): DocChangelog & { links: { href: DocHref; line: number }[] } {
  const front = readFrontMatter(source.text);
  for (const p of front.problems) report(p.message, p.line);
  const title = typeof front.data?.title === "string" ? front.data.title : null;
  const parsed = parseMarkdown(front.body, front.bodyLine);
  for (const p of parsed.problems) report(p.message, p.line);
  return { title, blocks: parsed.blocks, headings: parsed.headings, markdown: front.body.trim(), file: source.file, links: parsed.links };
}

function stripLinks(changelog: DocChangelog & { links: unknown }): DocChangelog {
  const { title, blocks, headings, markdown, file } = changelog;
  return { title, blocks, headings, markdown, file };
}

function compileSection(source: DocSource, track: DocTrack, slug: string, lang: DocLang, report: Report): DocSection | null {
  if (!SLUG.test(slug)) report(`The section folder ${slug} is not lower-case letters, digits and hyphens.`);
  const front = readFrontMatter(source.text);
  for (const p of front.problems) report(p.message, p.line);
  if (!front.data) {
    report("A section's file starts with front matter: title, order and summary.");
    return null;
  }
  const data = front.data;
  for (const key of Object.keys(data)) if (!["title", "order", "summary"].includes(key)) report(`A section's front matter has title, order and summary, not ${key}.`);
  const title = text(data.title);
  const order = data.order;
  if (!title) report("A section has a title.");
  if (typeof order !== "number") report("A section has an order: a whole number.");
  if (front.body.trim() !== "") report("A section's file holds its front matter only.");
  if (!title || typeof order !== "number") return null;
  return { track, slug, lang, title, summary: text(data.summary) ?? "", order, file: source.file };
}

const PAGE_KEYS = ["title", "summary", "track", "section", "kind", "areas", "features", "plans", "admin", "order", "checked", "sources", "operations", "tools"];

function compilePage(
  source: DocSource,
  where: { track: DocTrack; section: string; slug: string; lang: DocLang },
  context: DocsCheckContext,
  report: Report,
): { page: DocPage; links: { href: DocHref; line: number }[] } | null {
  const front = readFrontMatter(source.text);
  for (const p of front.problems) report(p.message, p.line);
  if (!front.data) {
    report("An article starts with front matter between two lines ---.");
    return null;
  }
  const data = front.data;
  let ok = true;
  const fail = (message: string) => {
    ok = false;
    report(message);
  };
  for (const key of Object.keys(data)) if (!PAGE_KEYS.includes(key)) fail(`Unknown front matter key ${key}.`);

  const title = text(data.title);
  if (!title) fail("title: the page's title, as words.");
  else if (title.length > 120) fail("title: at most 120 characters.");
  const summary = text(data.summary);
  if (!summary) fail("summary: one sentence about the page.");
  else if (summary.length > 300) fail("summary: at most 300 characters.");
  if (data.track !== where.track) fail(`track: ${where.track}, its folder's.`);
  if (data.section !== where.section) fail(`section: ${where.section}, its folder's.`);
  if (!SLUG.test(where.section)) fail(`The section folder ${where.section} is not lower-case letters, digits and hyphens.`);
  if (!isKind(data.kind)) fail(`kind: one of ${DOC_KINDS.join(", ")}.`);
  const order = data.order;
  if (typeof order !== "number") fail("order: a whole number, the page's place in its section.");
  const checked = text(data.checked);
  if (!checked || !isDocDate(checked)) fail("checked: the day the page was last checked against the product, YYYY-MM-DD.");

  const areas = list(data.areas, "areas", fail) ?? [];
  for (const area of areas) if (!isArea(area)) fail(`areas: ${area} is not one of DOC_AREAS (src/lib/docs-content.ts).`);
  if (areas.length === 0) fail("areas: at least one, from DOC_AREAS.");
  const features = list(data.features, "features", fail) ?? [];
  if (context.feature) for (const feature of features) if (!context.feature(feature)) fail(`features: ${feature} is not a store feature (D178).`);
  const plans = list(data.plans, "plans", fail) ?? [];
  for (const plan of plans) if (!SLUG.test(plan)) fail(`plans: ${plan} is not a plan's slug.`);
  const sources = list(data.sources, "sources", fail) ?? [];
  for (const id of sources) {
    if (!DECISION.test(id)) fail(`sources: ${id} is not a decision number (D123).`);
    else if (context.decision && !context.decision(id)) fail(`sources: ${id} has no row in docs/decisions.md.`);
  }
  const operations = list(data.operations, "operations", fail) ?? [];
  if (context.operation) for (const name of operations) if (!context.operation(name)) fail(`operations: ${name} is not an operation of the Admin API.`);
  const tools = list(data.tools, "tools", fail) ?? [];
  if (context.tool) for (const name of tools) if (!context.tool(name)) fail(`tools: ${name} is not a tool of the catalogue.`);

  let admin: string | null = null;
  if (data.admin !== undefined) {
    const value = text(data.admin);
    if (!value || !/^\/admin(?:\/|$)/.test(value)) fail("admin: an address in the admin, /admin/{store}/….");
    else if (context.adminPath && !context.adminPath(value)) fail(`admin: ${value} is not a page of the admin map (src/lib/admin-map.ts).`);
    else admin = value;
  }

  const parsed = parseMarkdown(front.body, front.bodyLine);
  for (const p of parsed.problems) report(p.message, p.line);
  if (parsed.problems.length > 0) ok = false;
  if (parsed.blocks.length === 0) fail("The page has no words below its front matter.");
  if (context.image) for (const image of parsed.images) if (!context.image(image.src)) report(`The picture ${image.src} is not a file under public/.`, image.line);

  if (!ok || !title || !summary || !isKind(data.kind) || typeof order !== "number" || !checked) return null;
  const path = `${where.track}/${where.section}/${where.slug}`;
  return {
    page: {
      ...where,
      path,
      file: source.file,
      title,
      summary,
      kind: data.kind,
      areas: areas.filter(isArea),
      features,
      plans,
      admin,
      order,
      checked,
      sources,
      operations,
      tools,
      blocks: parsed.blocks,
      headings: parsed.headings,
      markdown: front.body.trim(),
    },
    links: parsed.links,
  };
}

/** A link's target exists: another page (in English at least) and its heading, a heading of this page, the site's route, the admin's page. */
function checkLink(index: DocsIndex, page: DocPage | null, href: DocHref, context: DocsCheckContext, problem: (message: string) => void): void {
  if (href.kind === "anchor") {
    const headings = page ? page.headings : (index.changelog?.headings ?? []);
    if (!headings.some((h) => h.id === href.id)) problem(`#${href.id} is not a heading of this page.`);
    return;
  }
  if (href.kind === "doc") {
    const target = resolveDocLink(index, href.path, page?.lang ?? "en");
    if (target === null) {
      problem(`/docs/${href.path} is not a docs page.`);
      return;
    }
    if (href.anchor) {
      const headings = target === "changelog" ? (index.changelog?.headings ?? []) : typeof target === "object" ? target.headings : [];
      if (!headings.some((h) => h.id === href.anchor)) problem(`#${href.anchor} is not a heading of /docs/${href.path}.`);
    }
    return;
  }
  if (href.kind === "admin") {
    if (context.adminPath && !context.adminPath(href.path)) problem(`${href.path} is not a page of the admin map (src/lib/admin-map.ts).`);
    return;
  }
  if (href.kind === "site") {
    const path = href.path.split(/[?#]/)[0];
    if (context.sitePath && !context.sitePath(path)) problem(`${path} is not a page of Kaizena Flow's site.`);
  }
}

/**
 * What a docs link (`/docs/{path}`) leads to, from a page in `lang`: the page in that language where it has one, else in English; a track,
 * a section, the front page or the changelog as itself; null when nothing is there.
 */
export function resolveDocLink(index: DocsIndex, path: string, lang: DocLang): DocPage | "home" | "track" | "section" | "changelog" | null {
  if (path === "") return "home";
  if (path === DOCS_CHANGELOG_PATH) return index.changelog ? "changelog" : null;
  const parts = path.split("/");
  if (parts.length === 1) return isTrack(parts[0]) ? "track" : null;
  if (parts.length === 2) return index.sections.some((s) => s.track === parts[0] && s.slug === parts[1]) ? "section" : null;
  return index.pages.find((p) => p.path === path && p.lang === lang) ?? index.pages.find((p) => p.path === path && p.lang === "en") ?? null;
}

/** The language a link from a page in `lang` to the docs' `path` is drawn in: `lang` where the page exists in it, else English. */
export function docLinkLang(index: DocsIndex, path: string, lang: DocLang): DocLang {
  if (lang === "en") return "en";
  const parts = path.split("/");
  if (parts[0] !== "owners" && path !== "") return "en";
  if (parts.length === 3) return index.pages.some((p) => p.path === path && p.lang === lang) ? lang : "en";
  if (parts.length === 2) return index.sections.some((s) => s.track === parts[0] && s.slug === parts[1] && s.lang === lang) ? lang : "en";
  return lang;
}

function text(value: FrontMatterValue | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function list(value: FrontMatterValue | undefined, key: string, fail: (message: string) => void): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    fail(`${key}: a list, [a, b] or [].`);
    return null;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// The tree, the order and the neighbours
// ---------------------------------------------------------------------------------------------------------------------

const byOrderThenTitle = <T extends { order: number; title: string }>(a: T, b: T) => a.order - b.order || a.title.localeCompare(b.title, "en");

function sortSections(sections: DocSection[]): DocSection[] {
  return [...sections].sort((a, b) => a.track.localeCompare(b.track) || a.lang.localeCompare(b.lang) || byOrderThenTitle(a, b));
}

export type DocTreeSection = { section: DocSection; pages: DocPage[] };

/** A track's sections in a language, each with its pages, by `order` then title. */
export function docsTree(index: DocsIndex, track: DocTrack, lang: DocLang): DocTreeSection[] {
  return index.sections
    .filter((s) => s.track === track && s.lang === lang)
    .sort(byOrderThenTitle)
    .map((section) => ({
      section,
      pages: index.pages.filter((p) => p.track === track && p.lang === lang && p.section === section.slug).sort(byOrderThenTitle),
    }))
    .filter((entry) => entry.pages.length > 0);
}

/** A track's pages in a language in reading order: section by section, each by `order` then title. */
export function docsOrder(index: DocsIndex, track: DocTrack, lang: DocLang): DocPage[] {
  return docsTree(index, track, lang).flatMap((entry) => entry.pages);
}

/** The pages before and after one in its track's reading order. */
export function docNeighbours(index: DocsIndex, page: DocPage): { previous: DocPage | null; next: DocPage | null } {
  const order = docsOrder(index, page.track, page.lang);
  const at = order.findIndex((p) => p.path === page.path);
  return { previous: at > 0 ? order[at - 1] : null, next: at >= 0 && at < order.length - 1 ? order[at + 1] : null };
}

/** A page by its path and language. */
export function docPage(index: DocsIndex, path: string, lang: DocLang): DocPage | null {
  return index.pages.find((p) => p.path === path && p.lang === lang) ?? null;
}

/** A section by its track, slug and language. */
export function docSection(index: DocsIndex, track: DocTrack, slug: string, lang: DocLang): DocSection | null {
  return index.sections.find((s) => s.track === track && s.slug === slug && s.lang === lang) ?? null;
}

/** Every address the docs build in a language: the front page, the tracks, the sections, the pages and the changelog (`""` is the front page). */
export function docsPaths(index: DocsIndex, lang: DocLang): string[] {
  const tracks = DOC_TRACKS.filter((track) => DOC_TRACK_LANGS[track].includes(lang));
  return [
    "",
    ...tracks,
    ...tracks.flatMap((track) => docsTree(index, track, lang).flatMap(({ section, pages }) => [`${track}/${section.slug}`, ...pages.map((p) => p.path)])),
    ...(lang === "en" && index.changelog ? [DOCS_CHANGELOG_PATH] : []),
  ];
}

/** Whether a track is written in a language. */
export const trackIn = (track: DocTrack, lang: DocLang): boolean => DOC_TRACK_LANGS[track].includes(lang);

export { isTrack as isDocTrack, isLang as isDocLang };
