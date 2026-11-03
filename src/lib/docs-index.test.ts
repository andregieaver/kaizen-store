import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_API } from "./admin-api-routes";
import { API_ERRORS, API_SCOPES } from "./admin-api";
import { compileDocs, DOC_AREAS, resolveDocLink, type DocSource } from "./docs-content";
import { blocksText, clip, docsIndexFingerprint, docsIndexRows, embedText, pageParts, REFERENCE_PAGES, ROW_TEXT_MAX } from "./docs-index";
import { parseMarkdown } from "./docs-markdown";
import { docsReferenceItems } from "./docs-reference";
import { MCP_TOOLS } from "./mcp-catalogue";
import { UCP_TOOLS } from "./ucp-catalogue";
import { WEBHOOK_TOPICS } from "./webhook-topics";

const ROOT = process.cwd();

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

const { index } = compileDocs(repositorySources());
const items = docsReferenceItems();
const rows = docsIndexRows(index, items);

describe("the docs' search index as rows (D443)", () => {
  it("cuts a page at each ## and ###, a #### staying in its part", () => {
    const { blocks } = parseMarkdown("Intro words.\n\n## One\n\nFirst.\n\n### One a\n\nDeeper.\n\n#### Small\n\nStill here.\n\n## Two\n\n- a list\n- of things\n\n| A | B |\n|---|---|\n| c | d |\n");
    const parts = pageParts(blocks);
    expect(parts.map((p) => [p.anchor, p.headings])).toEqual([
      [null, []],
      ["one", ["One"]],
      ["one-a", ["One", "One a"]],
      ["two", ["Two"]],
    ]);
    expect(blocksText(parts[2].blocks)).toBe("Deeper.\nSmall\nStill here.");
    expect(blocksText(parts[3].blocks)).toBe("a list\nof things\nA B\nc d");
  });

  it("makes a row for every part of every article in each of its languages, with the page's facts", () => {
    const create = rows.filter((r) => r.doc === "en:owners/getting-started/create-your-store");
    expect(create.map((r) => r.url)).toEqual([
      "owners/getting-started/create-your-store",
      "owners/getting-started/create-your-store#sign-up",
      "owners/getting-started/create-your-store#follow-the-setup-steps",
      "owners/getting-started/create-your-store#before-you-open",
    ]);
    expect(create[0]).toMatchObject({
      key: "en:owners/getting-started/create-your-store#",
      item: "section",
      track: "owners",
      kind: "tutorial",
      lang: "en",
      areas: ["getting-started", "setup"],
      section: "owners/getting-started",
      sectionTitle: "Getting started",
      path: "owners/getting-started/create-your-store",
      title: "Create your store",
      headings: [],
      position: 0,
      checked: "2026-11-03",
    });
    // The start holds the summary; each part its own words.
    expect(create[0].text.startsWith("Sign up, confirm your email address")).toBe(true);
    expect(create[1].headings).toEqual(["Sign up"]);
    expect(create[1].text).toContain("Start your store");
    // Its Norwegian page, with the section's Norwegian title, follows it in the reading order.
    const norwegian = rows.find((r) => r.key === "nb:owners/getting-started/create-your-store#");
    expect(norwegian).toMatchObject({ lang: "nb", title: "Lag nettbutikken din", sectionTitle: "Kom i gang", reading: create[0].reading + 1 });
  });

  it("keeps every key once and every row within the table's limits", () => {
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.text.length, r.key).toBeLessThanOrEqual(ROW_TEXT_MAX);
      expect(r.title.length, r.key).toBeGreaterThan(0);
      expect(r.title.length, r.key).toBeLessThanOrEqual(300);
      expect(r.areas.length, r.key).toBeGreaterThan(0);
      for (const area of r.areas) expect(DOC_AREAS, r.key).toContain(area);
      expect(r.url, r.key).toMatch(/^[a-z0-9]/);
    }
    // One document's parts share their facts.
    for (const doc of new Set(rows.map((r) => r.doc))) {
      const parts = rows.filter((r) => r.doc === doc);
      expect(new Set(parts.map((p) => `${p.track}|${p.kind}|${p.lang}|${p.title}|${p.reading}`)).size, doc).toBe(1);
      expect(parts[0].position, doc).toBe(0);
    }
  });

  it("indexes the changelog's parts", () => {
    const log = rows.filter((r) => r.doc === "en:changelog");
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toMatchObject({ item: "changelog", kind: "changelog", track: "developers", path: "changelog", url: "changelog" });
  });

  it("makes a row for every reference item of unit A's contracts", () => {
    const count = (item: string) => rows.filter((r) => r.item === item).length;
    expect(count("operation")).toBe(ADMIN_API.length);
    expect(count("topic")).toBe(WEBHOOK_TOPICS.length);
    expect(count("tool")).toBe(MCP_TOOLS.length);
    expect(count("agent-tool")).toBe(UCP_TOOLS.length);
    expect(count("error")).toBe(Object.keys(API_ERRORS).length);
    expect(count("scope")).toBe(API_SCOPES.length);
    expect(rows.find((r) => r.key === "ref:operation:products.get")).toMatchObject({
      doc: "ref:operation:products.get",
      track: "developers",
      kind: "reference",
      lang: "en",
      title: "Get a product",
      code: "products.get · GET /api/admin/v1/products/{id}",
      areas: ["admin-api", "products"],
      path: null,
      checked: null,
    });
    expect(rows.find((r) => r.key === "ref:topic:order.paid")).toMatchObject({ code: "order.paid", areas: ["webhooks", "orders"] });
    expect(rows.find((r) => r.key === "ref:error:not_found")).toMatchObject({ code: "404 not_found", areas: ["errors", "admin-api"] });
    expect(rows.find((r) => r.key === "ref:scope:orders:write")?.text).toContain("Record parcels with tracking");
    // Reference items come after every article in the reading order.
    const lastArticle = Math.max(...rows.filter((r) => r.item === "section").map((r) => r.reading));
    expect(Math.min(...rows.filter((r) => r.doc.startsWith("ref:")).map((r) => r.reading))).toBeGreaterThan(lastArticle);
  });

  it("leads every reference item to a page and heading the docs have, until the generated reference (E4)", () => {
    for (const [item, url] of Object.entries(REFERENCE_PAGES)) {
      const [path, anchor] = url.split("#");
      const page = resolveDocLink(index, path, "en");
      expect(page && typeof page === "object", `${item}: ${path}`).toBe(true);
      if (page && typeof page === "object") expect(page.headings.map((h) => h.id), `${item}: #${anchor}`).toContain(anchor);
    }
    for (const r of rows.filter((r) => r.doc.startsWith("ref:"))) {
      const [path] = r.url.split("#");
      expect(resolveDocLink(index, path, "en"), r.key).not.toBeNull();
    }
  });

  it("leads an item to the article that names it in its front matter", () => {
    const front = "---\ntitle: Products\nsummary: The products API.\ntrack: developers\nsection: api\nkind: reference\nareas: [admin-api]\norder: 1\nchecked: 2026-11-03\nsources: []\noperations: [products.get]\n---\n\n## Get one\n\nWords.\n";
    const { index: own } = compileDocs([
      { file: "content/docs/developers/api/_section.en.md", text: "---\ntitle: API\norder: 1\n---\n" },
      { file: "content/docs/developers/api/products.en.md", text: front },
    ]);
    const ownRows = docsIndexRows(own, items);
    expect(ownRows.find((r) => r.key === "ref:operation:products.get")?.url).toBe("developers/api/products");
    expect(ownRows.find((r) => r.key === "ref:operation:products.list")?.url).toBe(REFERENCE_PAGES.operation);
  });

  it("has a fingerprint that moves with any row and stays with the same rows", () => {
    const again = docsIndexRows(compileDocs(repositorySources()).index, docsReferenceItems());
    expect(docsIndexFingerprint(again)).toBe(docsIndexFingerprint(rows));
    const changed = rows.map((r, i) => (i === 3 ? { ...r, text: `${r.text} more` } : r));
    expect(docsIndexFingerprint(changed)).not.toBe(docsIndexFingerprint(rows));
  });

  it("gives the embedding model a part's title, headings, code and words", () => {
    expect(embedText({ title: "T", headings: ["A", "B"], code: "x.y", text: "Words." })).toBe("T\nA › B\nx.y\nWords.");
    expect(embedText({ title: "T", headings: [], code: null, text: "" })).toBe("T");
  });

  it("cuts long words at a word, with an ellipsis", () => {
    expect(clip("one two three four", 16)).toBe("one two three…");
    expect(clip("short", 12)).toBe("short");
    expect(clip("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
