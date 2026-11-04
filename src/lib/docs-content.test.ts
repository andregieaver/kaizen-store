import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { matchPath } from "./admin-map";
import { docsApiReference } from "./docs-api-reference";
import {
  compileDocs,
  docLinkLang,
  docNeighbours,
  docsOrder,
  docsPaths,
  docsTree,
  resolveDocLink,
  type DocsCheckContext,
  type DocSource,
} from "./docs-content";
import { FEATURE_IDS } from "./store-features";

const ROOT = process.cwd();

// ---------------------------------------------------------------------------------------------------------------------
// The repository's own docs, checked as CI checks them (D442): every file compiles, every link and anchor lands, every admin address is
// in the admin map, every decision has its row, and every owners' page in English has its Norwegian page or a reason.
// ---------------------------------------------------------------------------------------------------------------------

/** Every file under `content/docs/`, as the loader reads them (`readDocSources()` in `src/server/docs.ts`). */
function repositorySources(): DocSource[] {
  const out: DocSource[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(md|json)$/.test(name)) out.push({ file: relative(ROOT, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
    }
  };
  walk(join(ROOT, "content/docs"));
  return out;
}

/** The decisions with a row in `docs/decisions.md` (`| D123 |`). */
const DECISIONS = new Set([...readFileSync(join(ROOT, "docs/decisions.md"), "utf8").matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]));

/** An admin address is a page of the admin map, each `{placeholder}` standing where the page has a parameter. */
function adminPath(path: string): boolean {
  const found = matchPath(path);
  if (!found) return false;
  const placeholders = path.split("/").filter((part) => /^\{.+\}$/.test(part));
  const filled = new Set([...Object.values(found.params), ...(found.storeSlug ? [found.storeSlug] : [])]);
  return placeholders.every((part) => filled.has(part));
}

/** The first parts of Kaizena Flow's own site's addresses that are routes of the app (not pages the platform's admins make). */
const SITE_ROUTES = new Set(
  [join(ROOT, "src/app"), join(ROOT, "src/app/(platform)")].flatMap((dir) => readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory() && !/^[([._]/.test(name))),
);
/** A page of the app, or a file the site serves from `public/` (the WordPress plugin's downloads under `/downloads/…`). */
const sitePath = (path: string) =>
  path === "/" || SITE_ROUTES.has(path.split("/")[1]) || (/^\/downloads\/[A-Za-z0-9._/-]+$/.test(path) && !path.includes("..") && existsSync(join(ROOT, "public", path)));

/**
 * Unit A's registry of the Admin API (`ADMIN_API` in `src/lib/admin-api-routes.ts`, D438) is written beside this unit: once it is in the
 * repository, the operations an article names are checked against it. Until then the check waits (an article names none yet).
 */
async function operationCheck(): Promise<DocsCheckContext["operation"]> {
  const file = join(ROOT, "src/lib/admin-api-routes.ts");
  if (!existsSync(file)) return undefined;
  const api = ((await import(/* @vite-ignore */ file)) as { ADMIN_API?: unknown }).ADMIN_API;
  const entries: unknown[] = Array.isArray(api) ? api : api && typeof api === "object" ? Object.entries(api).map(([key, value]) => ({ name: key, ...(value as object) })) : [];
  const names = new Set(entries.flatMap((entry) => (entry && typeof (entry as { name?: unknown }).name === "string" ? [(entry as { name: string }).name] : [])));
  return names.size > 0 ? (name) => names.has(name) : undefined;
}

describe("the repository's docs (D442)", () => {
  it("compile without a problem: front matter, links and anchors, admin addresses, decisions, pictures and the Norwegian pages", async () => {
    const context: DocsCheckContext = {
      decision: (id) => DECISIONS.has(id),
      adminPath,
      sitePath,
      image: (src) => existsSync(join(ROOT, "public", src)),
      feature: (id) => (FEATURE_IDS as readonly string[]).includes(id),
      operation: await operationCheck(),
      // The MCP tool catalogue (unit A, D438) is checked the same way once it ships: `tool: (name) => …`.
    };
    // With the generated reference (E4) beside the articles, so a link to one of its pages and headings is checked too.
    const { index, problems } = compileDocs(repositorySources(), context, docsApiReference().reference);
    expect(problems.map((p) => `${p.file}${p.line ? `:${p.line}` : ""} ${p.message}`)).toEqual([]);
    // The first pages, which the browser tests read.
    expect(docsPaths(index, "en")).toEqual(expect.arrayContaining([
      "owners/getting-started/create-your-store",
      "owners/getting-started/your-first-product",
      "developers/overview/introduction",
      "developers/overview/authentication",
      "changelog",
    ]));
    expect(docsPaths(index, "nb")).toEqual(expect.arrayContaining(["owners/getting-started/create-your-store", "owners/getting-started/your-first-product"]));
    expect(docsPaths(index, "nb").some((path) => path.startsWith("developers"))).toBe(false);
  });

  it("checks admin addresses as the admin map has them", () => {
    expect(adminPath("/admin/{store}/products/{id}")).toBe(true);
    expect(adminPath("/admin/{store}/products/new")).toBe(true);
    expect(adminPath("/admin/{store}/settings/api")).toBe(true);
    expect(adminPath("/admin/platform/docs/feedback")).toBe(true);
    expect(adminPath("/admin/{store}/no-such-page")).toBe(false);
    expect(adminPath("/admin/{store}/{what}")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The compiler, on files made up for the test.
// ---------------------------------------------------------------------------------------------------------------------

const front = (fields: Record<string, string>) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;

const PAGE = { kind: "how-to", areas: "[products]", order: "10", checked: "2026-11-03", sources: "[D442]" };

function article(track: string, section: string, slug: string, lang: string, extra: Record<string, string> = {}, body = "## Hello\n\nWords."): DocSource {
  return {
    file: `content/docs/${track}/${section}/${slug}.${lang}.md`,
    text: `${front({ title: `${slug} ${lang}`, summary: "A page.", track, section, ...PAGE, ...extra })}\n${body}\n`,
  };
}

const section = (track: string, slug: string, lang: string, order = 10, title = slug): DocSource => ({
  file: `content/docs/${track}/${slug}/_section.${lang}.md`,
  text: front({ title, order: String(order), summary: `About ${slug}.` }),
});

/** A small set of docs that compiles: owners in English and Norwegian, developers in English, the changelog and the list. */
function base(): DocSource[] {
  return [
    section("owners", "start", "en"),
    section("owners", "start", "nb", 10, "Start"),
    article("owners", "start", "first", "en", { order: "10" }, "## Sign up\n\nSee [the next](/docs/owners/start/second#more) and [ours](#sign-up)."),
    article("owners", "start", "first", "nb", { order: "10" }, "## Registrer deg\n\nSe [neste](/docs/owners/start/second)."),
    article("owners", "start", "second", "en", { order: "20" }, "## More\n\nText."),
    article("owners", "start", "second", "nb", { order: "20" }, "## Mer\n\nTekst."),
    section("developers", "overview", "en"),
    article("developers", "overview", "intro", "en", { kind: "concept", areas: "[admin-api]" }, "## APIs\n\nSee the [changelog](/docs/changelog#v1)."),
    { file: "content/docs/developers/changelog.md", text: "## 1.0 {#v1}\n\nFirst.\n" },
    { file: "content/docs/missing-nb.json", text: "{}" },
  ];
}

const problemsOf = (sources: DocSource[], context: DocsCheckContext = {}) => compileDocs(sources, context).problems.map((p) => `${p.file.replace("content/docs/", "")}: ${p.message}`);

describe("compiling the docs (D442)", () => {
  it("compiles a good set into pages, sections and the changelog", () => {
    const { index, problems } = compileDocs(base());
    expect(problems).toEqual([]);
    expect(index.pages.map((p) => `${p.path}.${p.lang}`).sort()).toEqual([
      "developers/overview/intro.en",
      "owners/start/first.en",
      "owners/start/first.nb",
      "owners/start/second.en",
      "owners/start/second.nb",
    ]);
    const first = index.pages.find((p) => p.path === "owners/start/first" && p.lang === "en");
    expect(first).toMatchObject({ track: "owners", section: "start", slug: "first", kind: "how-to", areas: ["products"], order: 10, checked: "2026-11-03", sources: ["D442"], admin: null });
    expect(first?.headings).toEqual([{ depth: 2, id: "sign-up", text: "Sign up" }]);
    expect(first?.markdown).toContain("See [the next]");
    expect(index.changelog?.headings).toEqual([{ depth: 2, id: "v1", text: "1.0" }]);
  });

  it("refuses bad front matter, each problem named", () => {
    const sources = [
      ...base().filter((s) => !s.file.includes("second")),
      article("owners", "start", "second", "en", { kind: "essay", areas: "[products, nonsense]", checked: "2026-02-30", track: "developers", colour: "red" }),
      article("owners", "start", "second", "nb", { title: '""', summary: "x".padEnd(301, "x"), order: "first", sources: "[431, D9999]" }),
    ];
    const problems = problemsOf(sources, { decision: (id) => id !== "D9999" });
    expect(problems).toEqual(
      expect.arrayContaining([
        "owners/start/second.en.md: Unknown front matter key colour.",
        "owners/start/second.en.md: track: owners, its folder's.",
        expect.stringMatching(/second\.en\.md: kind: one of/),
        expect.stringMatching(/second\.en\.md: checked: the day/),
        expect.stringMatching(/second\.en\.md: areas: nonsense is not one of DOC_AREAS/),
        expect.stringMatching(/second\.nb\.md: title:/),
        expect.stringMatching(/second\.nb\.md: summary: at most 300/),
        expect.stringMatching(/second\.nb\.md: order: a whole number/),
        "owners/start/second.nb.md: sources: 431 is not a decision number (D123).",
        "owners/start/second.nb.md: sources: D9999 has no row in docs/decisions.md.",
      ]),
    );
    // A page with a problem is left out, so the links to it fail too.
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/first\.en\.md: \/docs\/owners\/start\/second is not a docs page/)]));
  });

  it("refuses files where the docs do not keep them, unknown tracks, and languages a track is not written in", () => {
    const problems = problemsOf([
      ...base(),
      { file: "content/docs/owners/stray.en.md", text: "x" },
      { file: "content/docs/partners/start/a.en.md", text: "x" },
      section("developers", "overview", "nb"),
      article("developers", "overview", "intro", "nb"),
    ]);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/owners\/stray\.en\.md: Not where the docs keep their files/),
        expect.stringMatching(/partners\/start\/a\.en\.md: Unknown track partners/),
        expect.stringMatching(/developers\/overview\/_section\.nb\.md: The developers track is written in en, not nb/),
        expect.stringMatching(/developers\/overview\/intro\.nb\.md: The developers track is written in en, not nb/),
      ]),
    );
  });

  it("refuses a page in a section without its title, and a section without pages", () => {
    const problems = problemsOf([...base(), article("owners", "orphans", "lost", "en"), section("owners", "empty", "en"), { file: "content/docs/missing-nb.json", text: '{"owners/orphans/lost": "Written in English first, the Norwegian follows."}' }].filter((s, i, all) => all.findIndex((t) => t.file === s.file) === i || !s.file.endsWith(".json")));
    expect(problems).toEqual(
      expect.arrayContaining([
        "owners/orphans/lost.en.md: The section owners/orphans has no _section.en.md with its title.",
        "owners/empty/_section.en.md: A section without a page in its language: add one or remove the section.",
      ]),
    );
  });

  it("checks every link and anchor: to pages, their headings, this page's, the site, the admin", () => {
    const body = [
      "[a](/docs/owners/start/nowhere) [b](/docs/owners/start/second#missing) [c](#nope) [d](/docs/owners/start) [e](/docs/owners)",
      "[f](/docs/changelog#v2) [g](/sign-up) [h](/no-such-route) [i](/admin/{store}/products) [j](/admin/{store}/nothing) [k](/docs/reference)",
    ].join("\n");
    const sources = base().map((s) => (s.file.endsWith("first.en.md") ? article("owners", "start", "first", "en", { order: "10" }, `## Sign up\n\n${body}`) : s));
    const problems = problemsOf(sources, { sitePath: (path) => path === "/sign-up", adminPath: (path) => path === "/admin/{store}/products" });
    expect(problems.filter((p) => p.startsWith("owners/start/first.en.md")).map((p) => p.replace("owners/start/first.en.md: ", ""))).toEqual([
      "/docs/owners/start/nowhere is not a docs page.",
      "#missing is not a heading of /docs/owners/start/second.",
      "#nope is not a heading of this page.",
      "#v2 is not a heading of /docs/changelog.",
      "/no-such-route is not a page of Kaizena Flow's site.",
      "/admin/{store}/nothing is not a page of the admin map (src/lib/admin-map.ts).",
      "/docs/reference is not a docs page.",
    ]);
  });

  it("checks the admin field, features, pictures and, once the registries ship, operations and tools", () => {
    const sources = base().map((s) =>
      s.file.endsWith("second.en.md")
        ? article("owners", "start", "second", "en", { order: "20", admin: "/admin/{store}/nothing", features: "[shop, flying]", operations: "[products.get, products.fly]", tools: "[list_products]" }, "## More\n\n![A picture](/kaizen/docs/missing.png)")
        : s,
    );
    const problems = problemsOf(sources, {
      adminPath: () => false,
      feature: (id) => id === "shop",
      image: () => false,
      operation: (name) => name === "products.get",
      tool: () => false,
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/admin: \/admin\/\{store\}\/nothing is not a page of the admin map/),
        "owners/start/second.en.md: features: flying is not a store feature (D178).",
        "owners/start/second.en.md: operations: products.fly is not an operation of the Admin API.",
        "owners/start/second.en.md: tools: list_products is not a tool of the catalogue.",
        "owners/start/second.en.md: The picture /kaizen/docs/missing.png is not a file under public/.",
      ]),
    );
    // Without the registries the names are kept, not checked.
    expect(compileDocs(sources).index.pages.find((p) => p.path === "owners/start/second" && p.lang === "en")?.operations).toEqual(["products.get", "products.fly"]);
  });

  it("asks for the Norwegian page of an owners' page in English, or the reason it has none", () => {
    const without = base().filter((s) => !s.file.endsWith("second.nb.md"));
    expect(problemsOf(without)).toEqual([expect.stringMatching(/owners\/start\/second\.en\.md: No Norwegian page/)]);
    const listed = without.map((s) => (s.file.endsWith(".json") ? { ...s, text: '{"owners/start/second": "Waits for the Norwegian review of the section."}' } : s));
    expect(problemsOf(listed)).toEqual([]);
    const stale = base().map((s) => (s.file.endsWith(".json") ? { ...s, text: '{"owners/start/second": "Waits for the Norwegian review of the section.", "owners/start/gone": "x is not a reason long"}' } : s));
    expect(problemsOf(stale)).toEqual([
      "missing-nb.json: owners/start/second has its Norwegian page now: take it off the list.",
      "missing-nb.json: owners/start/gone is not an owners' page in English.",
    ]);
    expect(problemsOf(base().map((s) => (s.file.endsWith(".json") ? { ...s, text: '{"owners/start/second": "short"}' } : s)))).toEqual(
      expect.arrayContaining(["missing-nb.json: owners/start/second: the reason is a sentence."]),
    );
    // A Norwegian page needs its English one.
    expect(problemsOf([...base(), article("owners", "start", "third", "nb")])).toEqual(["owners/start/third.nb.md: A page in Norwegian without its English page."]);
  });

  it("refuses unsafe Markdown in an article, so CI fails on it", () => {
    const sources = base().map((s) => (s.file.endsWith("second.en.md") ? article("owners", "start", "second", "en", { order: "20" }, "## More\n\n<script>alert(1)</script> [x](javascript:alert(1))") : s));
    expect(problemsOf(sources)).toEqual(
      expect.arrayContaining([expect.stringMatching(/second\.en\.md: HTML is not allowed/), expect.stringMatching(/second\.en\.md: The link "javascript:alert\(1\)" is refused/)]),
    );
  });
});

describe("the tree, the reading order and the links between languages (D442)", () => {
  const sources = [
    ...base(),
    section("owners", "later", "en", 20, "Later"),
    section("owners", "later", "nb", 20, "Senere"),
    article("owners", "later", "zeta", "en", { order: "10", title: "Zeta" }),
    article("owners", "later", "alpha", "en", { order: "10", title: "Alpha" }),
    article("owners", "later", "first-of-all", "en", { order: "5", title: "Omega" }),
    article("owners", "later", "zeta", "nb", { order: "10", title: "Zeta" }),
    { file: "content/docs/missing-nb.json", text: '{"owners/later/alpha": "Written in English first, the Norwegian follows.", "owners/later/first-of-all": "Written in English first, the Norwegian follows."}' },
  ].filter((s, i, all) => !(s.file.endsWith("missing-nb.json") && all.findLastIndex((t) => t.file === s.file) !== i));
  const { index, problems } = compileDocs(sources);

  it("orders sections and pages by order, then title", () => {
    expect(problems).toEqual([]);
    expect(docsTree(index, "owners", "en").map((e) => [e.section.slug, e.pages.map((p) => p.title)])).toEqual([
      ["start", ["first en", "second en"]],
      ["later", ["Omega", "Alpha", "Zeta"]],
    ]);
    expect(docsOrder(index, "owners", "nb").map((p) => p.slug)).toEqual(["first", "second", "zeta"]);
  });

  it("gives each page its previous and next across sections, in its own language", () => {
    const page = (path: string, lang: "en" | "nb") => index.pages.find((p) => p.path === path && p.lang === lang)!;
    expect(docNeighbours(index, page("owners/start/second", "en"))).toMatchObject({ previous: { slug: "first" }, next: { slug: "first-of-all" } });
    expect(docNeighbours(index, page("owners/start/first", "en")).previous).toBeNull();
    expect(docNeighbours(index, page("owners/later/zeta", "en")).next).toBeNull();
    expect(docNeighbours(index, page("owners/start/second", "nb"))).toMatchObject({ previous: { slug: "first", lang: "nb" }, next: { slug: "zeta", lang: "nb" } });
  });

  it("lists every address the build draws in each language", () => {
    expect(docsPaths(index, "en")).toEqual([
      "",
      "owners",
      "developers",
      "owners/start",
      "owners/start/first",
      "owners/start/second",
      "owners/later",
      "owners/later/first-of-all",
      "owners/later/alpha",
      "owners/later/zeta",
      "developers/overview",
      "developers/overview/intro",
      "changelog",
    ]);
    expect(docsPaths(index, "nb")).toEqual(["", "owners", "owners/start", "owners/start/first", "owners/start/second", "owners/later", "owners/later/zeta"]);
  });

  it("links a Norwegian page to the Norwegian page where there is one, else the English", () => {
    expect(docLinkLang(index, "owners/later/zeta", "nb")).toBe("nb");
    expect(docLinkLang(index, "owners/later/alpha", "nb")).toBe("en");
    expect(docLinkLang(index, "developers/overview/intro", "nb")).toBe("en");
    expect(docLinkLang(index, "changelog", "nb")).toBe("en");
    expect(docLinkLang(index, "owners/start", "nb")).toBe("nb");
    expect(docLinkLang(index, "owners/later/zeta", "en")).toBe("en");
    expect(resolveDocLink(index, "owners/later/alpha", "nb")).toMatchObject({ lang: "en" });
    expect(resolveDocLink(index, "", "en")).toBe("home");
    expect(resolveDocLink(index, "owners", "en")).toBe("track");
    expect(resolveDocLink(index, "owners/later", "en")).toBe("section");
    expect(resolveDocLink(index, "owners/nowhere", "en")).toBeNull();
  });
});
