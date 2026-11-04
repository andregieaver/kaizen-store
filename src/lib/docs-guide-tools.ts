/**
 * The docs guide's tools (wave 14 unit E5, D444) that answer from the docs and unit A's contracts alone, pure: a page's sections, an API
 * operation, a webhook topic, an MCP tool, and where `navigate` may go. Each answer is what the docs publish (the generated reference's own
 * words for an item, `docsApiReference()`), with the page it is on, so the answer can link it. Nothing here reads a store: the search and the
 * signed-in person's stores are `src/server/docs-guide.ts`'s.
 */

import { ADMIN_API, errorsOf } from "./admin-api-routes";
import { matchPath, pageParams } from "./admin-map";
import {
  DOCS_CHANGELOG_PATH,
  docPage,
  docRefPage,
  docSection,
  docsTree,
  isDocTrack,
  isReferencePath,
  type DocHeading,
  type DocLang,
  type DocsIndex,
} from "./docs-content";
import type { GuideAction, GuideLink } from "./docs-guide-shape";
import { docsPath, docsSiteHref } from "./docs-host";
import { blocksText, clip, generatedItemUrls, pageParts } from "./docs-index";
import type { Block } from "./docs-markdown";
import { mcpCatalogue } from "./mcp-catalogue";
import { STOREFRONT_ROUTES } from "./storefront-api";
import { UCP_TOOLS } from "./ucp-catalogue";
import { WEBHOOK_TOPICS } from "./webhook-topics";

/** What a tool answers the model (JSON-able), and the page of the docs it read, for the answer's links. */
export type GuideToolAnswer = { result: Record<string, unknown>; link?: GuideLink };

/** A page as the guide names it: its path in the docs and, after `#`, a section's anchor. */
const PAGE = /^([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,4})(?:#([a-z0-9][a-z0-9-]*))?$/;

/** A page the model named, read leniently (a leading slash, `/docs/` or `/no/docs/`, a trailing `.md`), or null. */
export function pageRef(raw: string): { path: string; anchor: string | null } | null {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/(?:no\/)?(?:docs\/)?/, "")
    .replace(/\.md(?=#|$)/, "")
    .replace(/\/+(?=#|$)/, "");
  const match = PAGE.exec(cleaned);
  return match ? { path: match[1], anchor: match[2] ?? null } : null;
}

/** The most characters of a page's words one answer carries; the sections not shown are named, to read by their anchor. */
const READ_MAX = 5000;
/** The most of a reference item's own section. */
const ITEM_MAX = 3500;

type Section = { heading: string; anchor: string | null; text: string };

/** A page's sections: its start, then each `##` and `###` with its words (as the search's index cuts it, `pageParts()`). */
function sectionsOf(blocks: readonly Block[]): Section[] {
  return pageParts(blocks)
    .map((part) => ({ heading: part.headings.join(" › "), anchor: part.anchor, text: blocksText(part.blocks) }))
    .filter((section) => section.text.trim() !== "" || section.anchor !== null);
}

/** The sections that fit, the asked one first, and the anchors of the rest. */
function fitSections(sections: readonly Section[], anchor: string | null, max: number): { sections: Section[]; more: string[] } {
  const first = anchor ? sections.findIndex((s) => s.anchor === anchor) : -1;
  const order = first >= 0 ? [...sections.slice(first), ...sections.slice(0, first)] : [...sections];
  const shown: Section[] = [];
  const more: string[] = [];
  let used = 0;
  for (const section of order) {
    const room = max - used;
    if (room < 200 && shown.length > 0) {
      if (section.anchor) more.push(section.anchor);
      continue;
    }
    const text = section.text.length > room ? clip(section.text, Math.max(room, 200)) : section.text;
    shown.push({ ...section, text });
    used += text.length + section.heading.length + 40;
  }
  return { sections: shown, more };
}

/** An item's own section of a reference page: its `##` and the `###`s below it, the example last (it is long). */
function itemSection(blocks: readonly Block[], headings: readonly DocHeading[], anchor: string | null, max: number): string {
  const parts = pageParts(blocks);
  const h2 = anchor ? headings.find((h) => h.id === anchor && h.depth === 2) : null;
  const own = h2 ? parts.filter((p) => p.headings[0] === h2.text && (p.anchor === anchor || p.headings.length === 2)) : parts;
  const ordered = [...own.filter((p) => !p.anchor?.endsWith("-example")), ...own.filter((p) => p.anchor?.endsWith("-example"))];
  return clip(ordered.map((p) => [p.headings.at(-1), blocksText(p.blocks)].filter(Boolean).join("\n")).join("\n\n"), max);
}

/** A page's link under the answer: its address on whichever host serves the docs, with the section's anchor. */
const linkTo = (path: string, anchor: string | null, lang: DocLang, title: string): GuideLink => ({ title, href: `${docsPath(path, lang)}${anchor ? `#${anchor}` : ""}` });

const pageName = (path: string, anchor: string | null) => `${path}${anchor ? `#${anchor}` : ""}`;

/**
 * `read_doc`: a page's title, summary, check date and sections (an article in the reader's language where it has one, else English; a page
 * of the generated reference; the changelog; a track or a section as its list of pages). Null-free: a page the docs do not have says so.
 */
export function readDoc(index: DocsIndex, raw: string, lang: DocLang): GuideToolAnswer {
  const ref = pageRef(raw);
  if (!ref) return { result: { error: "Give a page as search_docs returned it, such as owners/getting-started/create-your-store." } };
  const { path, anchor } = ref;
  if (path === DOCS_CHANGELOG_PATH && index.changelog) {
    const { sections, more } = fitSections(sectionsOf(index.changelog.blocks), anchor, READ_MAX);
    const title = index.changelog.title ?? "Changelog";
    return { result: { page: pageName(path, anchor), lang: "en", title, sections, ...(more.length > 0 && { moreSections: more }) }, link: linkTo(path, anchor, "en", title) };
  }
  if (isReferencePath(path)) {
    const page = docRefPage(index, path);
    if (!page) return { result: { error: `The docs have no page ${path}. Search first.` } };
    const { sections, more } = fitSections(sectionsOf(page.blocks), anchor, READ_MAX);
    const heading = anchor ? page.headings.find((h) => h.id === anchor)?.text : null;
    return {
      result: { page: pageName(path, anchor), lang: "en", title: page.title, summary: page.summary, track: "developers", generated: true, sections, ...(more.length > 0 && { moreSections: more }) },
      link: linkTo(path, anchor, "en", heading ? `${page.title}: ${heading}` : page.title),
    };
  }
  const segments = path.split("/");
  if (segments.length <= 2 && isDocTrack(segments[0])) {
    const track = segments[0];
    const trackLang: DocLang = track === "developers" ? "en" : lang;
    const tree = docsTree(index, track, trackLang).filter((entry) => segments.length === 1 || entry.section.slug === segments[1]);
    if (tree.length === 0) return { result: { error: `The docs have no section ${path}. Search first.` } };
    const section = segments.length === 2 ? docSection(index, track, segments[1], trackLang) : null;
    return {
      result: {
        page: path,
        lang: trackLang,
        title: section?.title ?? track,
        ...(section?.summary && { summary: section.summary }),
        pages: tree.flatMap((entry) => entry.pages.map((p) => ({ page: p.path, title: p.title, summary: p.summary }))),
      },
      link: linkTo(path, null, trackLang, section?.title ?? track),
    };
  }
  const page = docPage(index, path, lang) ?? docPage(index, path, "en");
  if (!page) return { result: { error: `The docs have no page ${path}. Search first.` } };
  const { sections, more } = fitSections(sectionsOf(page.blocks), anchor, READ_MAX);
  const heading = anchor ? page.headings.find((h) => h.id === anchor)?.text : null;
  return {
    result: {
      page: pageName(path, anchor),
      lang: page.lang,
      title: page.title,
      summary: page.summary,
      track: page.track,
      kind: page.kind,
      checked: page.checked,
      ...(page.admin && { inTheAdmin: page.admin }),
      ...(page.lang !== lang && { note: "This page is in English only." }),
      sections,
      ...(more.length > 0 && { moreSections: more }),
    },
    link: linkTo(path, anchor, page.lang, heading ? `${page.title}: ${heading}` : page.title),
  };
}

/** An item of the generated reference by its kind and id: its page and anchor, or null. */
function referenceOf(index: DocsIndex, key: string): { path: string; anchor: string | null } | null {
  const url = generatedItemUrls(index).get(key);
  return url ? pageRef(url) : null;
}

/** An item's facts, its section of the reference and its link. */
function withReference(index: DocsIndex, key: string, facts: Record<string, unknown>, title: string): GuideToolAnswer {
  const at = referenceOf(index, key);
  const page = at ? docRefPage(index, at.path) : null;
  if (!at || !page) return { result: facts };
  return {
    result: { ...facts, page: pageName(at.path, at.anchor), reference: itemSection(page.blocks, page.headings, at.anchor, ITEM_MAX) },
    link: linkTo(at.path, at.anchor, "en", title),
  };
}

/** The closest names to what was asked, for an answer that found none. */
function closest(names: readonly string[], asked: string, limit = 6): string[] {
  const words = asked.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return names
    .map((name) => ({ name, score: words.filter((w) => name.toLowerCase().includes(w)).length }))
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((n) => n.name);
}

const shape = (path: string) => path.replace(/\{[^}]+\}/g, "{}").replace(/\/+$/, "");

/** `api_operation`: one Admin API operation by its name or its method and path, or a storefront route by its method and path. */
export function apiOperation(index: DocsIndex, asked: string, api: "admin" | "storefront" = "admin"): GuideToolAnswer {
  const words = asked.trim();
  const call = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/i.exec(words);
  const method = call?.[1].toUpperCase();
  const path = call ? shape(call[2].replace(/^https?:\/\/[^/]+/, "").replace(/^\/api\/(?:admin|storefront)\/v1(?:\/\{[^}]+\})?/, "").split("?")[0]) : null;
  if (api === "storefront" || (path && !ADMIN_API.some((o) => o.method === method && shape(o.path) === path) && STOREFRONT_ROUTES.some((r) => r.method === method && shape(r.path) === path))) {
    const route = STOREFRONT_ROUTES.find((r) => r.method === method && shape(r.path) === path);
    if (!route) return { result: { error: `No storefront route ${words}.`, routes: STOREFRONT_ROUTES.map((r) => `${r.method} ${r.path}`) } };
    const heading = index.reference.pages
      .filter((p) => p.parent === "reference/storefront-api")
      .flatMap((p) => p.headings.filter((h) => h.depth === 2 && h.text === `${route.method} ${route.path}`).map((h) => ({ page: p, h })))[0];
    const facts = { api: "Storefront API", method: route.method, path: `/api/storefront/v1/{store}${route.path}`, does: route.text, errors: route.errors };
    if (!heading) return { result: facts };
    return {
      result: { ...facts, page: pageName(heading.page.path, heading.h.id), reference: itemSection(heading.page.blocks, heading.page.headings, heading.h.id, ITEM_MAX) },
      link: linkTo(heading.page.path, heading.h.id, "en", `${heading.page.title}: ${heading.h.text}`),
    };
  }
  const op = ADMIN_API.find((o) => o.name === words || (method !== undefined && o.method === method && shape(o.path) === path));
  if (!op) return { result: { error: `No Admin API operation ${words}.`, closest: closest(ADMIN_API.map((o) => o.name), words) } };
  return withReference(
    index,
    `operation:${op.name}`,
    { api: "Admin API", name: op.name, method: op.method, path: `/api/admin/v1${op.path}`, scope: op.scope, summary: op.summary, does: op.description, errors: errorsOf(op) },
    `${op.summary} (${op.name})`,
  );
}

/** `webhook_topic`: one topic with its payload as the reference shows it, or every topic's id and title. */
export function webhookTopic(index: DocsIndex, asked: string | undefined): GuideToolAnswer {
  const id = asked?.trim().toLowerCase();
  if (!id) return { result: { topics: WEBHOOK_TOPICS.map((t) => ({ topic: t.id, title: t.title })) } };
  const topic = WEBHOOK_TOPICS.find((t) => t.id === id);
  if (!topic) return { result: { error: `No webhook topic ${id}.`, closest: closest(WEBHOOK_TOPICS.map((t) => t.id), id) } };
  return withReference(index, `topic:${topic.id}`, { topic: topic.id, title: topic.title, when: topic.description, sentTo: topic.receivers }, `${topic.id}: ${topic.title}`);
}

/** `mcp_tool`: a tool of the owner MCP's catalogue or of the shopping agents', with its gate, permission, scope and inputs. */
export function mcpTool(index: DocsIndex, asked: string): GuideToolAnswer {
  const name = asked.trim();
  const own = mcpCatalogue().tools.find((t) => t.name === name);
  if (own) {
    return withReference(
      index,
      `tool:${own.name}`,
      { server: "The owner MCP (/api/mcp)", name: own.name, title: own.title, does: own.description, gate: own.gate, permission: own.permission, scope: own.scope, feature: own.feature, hints: own.annotations },
      `${own.title} (${own.name})`,
    );
  }
  const agent = UCP_TOOLS.find((t) => t.name === name);
  if (agent) {
    return withReference(
      index,
      `agent-tool:${agent.name}`,
      { server: "The shopping agents' MCP (/api/ucp/{store}/mcp)", name: agent.name, title: agent.title, does: agent.description, hints: agent.annotations },
      `${agent.title} (${agent.name})`,
    );
  }
  return { result: { error: `No MCP tool ${name}.`, closest: closest([...mcpCatalogue().tools.map((t) => t.name), ...UCP_TOOLS.map((t) => t.name)], name) } };
}

/** `navigate` to a docs page: one the docs have (in the reader's language where it is written in it), with its title. */
export function docsTarget(index: DocsIndex, raw: string, lang: DocLang): GuideAction | null {
  const ref = pageRef(raw);
  if (!ref) return raw.trim() === "" ? { type: "navigate", href: docsPath("", lang), label: "Docs" } : null;
  const read = readDoc(index, pageName(ref.path, ref.anchor), lang);
  if (!read.link) return null;
  return { type: "navigate", href: read.link.href, label: read.link.title };
}

/** Who is asking to be taken to the admin: a signed-in person's stores (their addresses) and whether they run the platform. */
export type AdminVisitor = { stores: readonly string[]; platformAdmin: boolean };

/**
 * `navigate` to an admin page (D444): only for a signed-in person, only to a page of the admin map (D107) that shows no single record (no
 * `[id]` in its address), and never to a store's data by an id the model wrote. A store's page opens in the person's one store; with several,
 * the admin's front page, where they choose (the store in the path is never the model's). A platform page only for the platform's admins.
 */
export function adminTarget(raw: string, who: AdminVisitor | null): GuideAction | { error: string } {
  if (!who) return { error: "The reader is not signed in here, so the admin cannot be opened. Name the admin's page in words." };
  const path = raw.trim().split(/[?#]/)[0].replace(/\/+$/, "");
  if (!/^\/admin(?:\/[A-Za-z0-9{}[\]._-]+)*$/.test(path)) return { error: "Give the admin page's path as the docs give it, such as /admin/{store}/products." };
  const found = matchPath(path.replace(/\{store\}|\[store\]/g, "x-store"));
  if (!found) return { error: "The admin has no such page." };
  const { page } = found;
  if (pageParams(page).some((name) => name !== "store")) return { error: "That page shows one record; open the list it is on instead, or name it in words." };
  if (page.area === "platform") {
    if (!who.platformAdmin) return { error: "That page is for Kaizena Flow's own team." };
    return { type: "navigate", href: docsSiteHref(`/admin/platform${page.path}`), label: page.title };
  }
  if (page.area === "account") return { type: "navigate", href: docsSiteHref(`/admin${page.path}`), label: page.title };
  if (who.stores.length !== 1) return { type: "navigate", href: docsSiteHref("/admin"), label: page.title };
  return { type: "navigate", href: docsSiteHref(`/admin/${who.stores[0]}${page.path}`), label: page.title };
}
