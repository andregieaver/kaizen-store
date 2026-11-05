import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { NO_FILTERS, type DocsSearchAnswer, type DocsSearchQuery } from "@/lib/docs-search";

import type { AiConnection } from "./ai";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

/**
 * The platform's AI as the test sets it: none (search by words alone, as on a platform without an embedding model), or a stand-in whose
 * "vectors" put the parts of *Create your store* and the question "kickstart a webshop" (whose words no page holds) close together and
 * everything else apart, so search by meaning is tested without a provider.
 */
let platformAi: AiConnection | null = null;
const toyVector = (text: string) => (text.startsWith("Create your store\n") || text === "kickstart a webshop" ? [1, 0.1, 0] : [0, 1, 0.1]);
const embedded: string[] = [];
vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai")>()),
  aiFor: async () => platformAi,
  embedTexts: async (_connection: AiConnection, texts: string[]) => {
    embedded.push(...texts);
    return { vectors: texts.map(toyVector), region: null };
  },
}));

const search = await import("./docs-search");
const { GET } = await import("@/app/api/docs/search/route");
const miss = await import("@/app/api/docs/search/miss/route");
const read = await import("@/app/api/docs/read/route");
const { BUDGETS, budgetBuckets, budgetVisitor, FAIL_CLOSED } = await import("./request-budget");

/**
 * The docs' search (D443) against a real database: the index written from the repository's own articles and unit A's contracts, rewritten
 * only when its fingerprint moves (keeping vectors of unchanged words); keyword search with titles and headings first, typos, synonyms and
 * the any-word fallback; filters and their counts; the four orders and the cursor; meaning merged by rank; misses and reads counted once
 * an hour a reader, nothing about the reader kept; Norwegian; and the routes' doors.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let visitor = 0;
const headersFrom = (more: Record<string, string> = {}) => ({ host: "localhost:3000", "x-forwarded-for": `203.0.113.${(visitor++ % 250) + 1}-${run}`, ...more });

const ask = (q: string, over: Partial<DocsSearchQuery> = {}): Promise<DocsSearchAnswer> =>
  search.searchDocs({ q, filters: NO_FILTERS, sort: "relevance", cursor: null, ...over }).then((result) => {
    if (!result.ok) throw new Error(result.problem);
    return result.answer;
  });

const docsOf = (answer: DocsSearchAnswer) => answer.results.map((r) => r.doc);

async function clean() {
  await db().execute(sql`delete from commerce.docs_index`);
  await db().execute(sql`delete from commerce.docs_index_state`);
  await db().execute(sql`delete from commerce.docs_search_misses`);
  await db().execute(sql`delete from commerce.docs_reads`);
  await db().execute(sql`delete from commerce.chat_usage where bucket like 'docs_%' or bucket like 'budget:docs_%'`);
}

beforeAll(async () => {
  await clean();
});

afterAll(async () => {
  await clean();
  await closeDb();
});

describe("the index (D443)", () => {
  it("is written from the deployed articles and contracts when its fingerprint differs, and left alone when it does not", async () => {
    const { rows, hash } = search.deployedDocsRows();
    const first = await search.refreshDocsIndex({ embed: false });
    expect(first).toEqual({ written: true, rows: rows.length, embedded: 0, failed: null });
    const [count] = await db().execute<Row>(sql`select count(*)::int as n, count(distinct doc)::int as docs from commerce.docs_index`);
    expect(count.n).toBe(rows.length);
    const [state] = await db().execute<Row>(sql`select hash, rows from commerce.docs_index_state`);
    expect(state).toEqual({ hash, rows: rows.length });
    expect((await search.refreshDocsIndex({ embed: false })).written).toBe(false);
    // The language's dictionary stems each row: a Norwegian row's words in Norwegian, an English row's in English.
    const [nb] = await db().execute<Row>(sql`select search::text as search from commerce.docs_index where key = 'nb:owners/getting-started/your-first-product#'`);
    expect(String(nb.search)).toContain("'produkt'");
    // Written only by server code: row-level security on, no policy.
    const [rls] = await db().execute<Row>(sql`
      select c.relrowsecurity as on, (select count(*)::int from pg_policies p where p.schemaname = 'commerce' and p.tablename = 'docs_index') as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'commerce' and c.relname = 'docs_index'
    `);
    expect(rls).toEqual({ on: true, policies: 0 });
  });

  it("rewrites what changed, removes what is gone and keeps a vector while its words are the same", async () => {
    const { rows } = search.deployedDocsRows();
    platformAi = { provider: "openai", source: "platform", apiUrl: "https://ai.example", apiKey: "k", space: "toy|4", embeddingModel: "toy", minSimilarity: 0.3 } as unknown as AiConnection;
    const first = await search.refreshDocsIndex();
    expect(first.written).toBe(false);
    expect(first.embedded).toBe(Math.min(rows.length, 256));
    // The rest on the next runs, 256 a run.
    while ((await search.refreshDocsIndex()).embedded > 0);
    const [all] = await db().execute<Row>(sql`select count(*) filter (where embedding is null)::int as bare from commerce.docs_index`);
    expect(all.bare).toBe(0);

    const changed = rows.filter((r) => r.key !== "ref:error:failed").map((r) => (r.key === "en:owners/getting-started/create-your-store#sign-up" ? { ...r, text: `${r.text} Changed.` } : r));
    expect((await search.refreshDocsIndex({ rows: changed, embed: false })).written).toBe(true);
    const kept = await db().execute<Row>(sql`select key, space from commerce.docs_index where key in ('en:owners/getting-started/create-your-store#sign-up', 'en:owners/getting-started/create-your-store#before-you-open', 'ref:error:failed')`);
    expect(Object.fromEntries(kept.map((r) => [r.key, r.space]))).toEqual({
      "en:owners/getting-started/create-your-store#sign-up": null,
      "en:owners/getting-started/create-your-store#before-you-open": "toy|4",
    });
    // Back to the deployment's own rows, with their vectors.
    expect((await search.refreshDocsIndex()).written).toBe(true);
    const [bare] = await db().execute<Row>(sql`select count(*) filter (where embedding is null)::int as n from commerce.docs_index`);
    expect(bare.n).toBe(0);
    platformAi = null;
  });

  it("is written on the first search when it is still empty (a fresh database, the minutes after the first deploy)", async () => {
    await db().execute(sql`delete from commerce.docs_index`);
    await db().execute(sql`delete from commerce.docs_index_state`);
    const answer = await ask("create your store");
    expect(answer.results[0]?.doc).toBe("en:owners/getting-started/create-your-store");
    const [state] = await db().execute<Row>(sql`select rows from commerce.docs_index_state`);
    expect(state.rows).toBe(search.deployedDocsRows().rows.length);
  });
});

describe("search by words (D443)", () => {
  it("finds a page by its title first, at the part whose heading matches", async () => {
    const answer = await ask("create your store");
    expect(answer.match).toBe("all");
    expect(answer.meaning).toBe(false);
    expect(answer.results[0]).toMatchObject({
      doc: "en:owners/getting-started/create-your-store",
      href: "/docs/owners/getting-started/create-your-store",
      item: "section",
      track: "owners",
      kind: "tutorial",
      lang: "en",
      title: "Create your store",
      section: { path: "owners/getting-started", title: "Getting started" },
      checked: "2026-11-03",
    });
    const heading = await ask("setup steps");
    const hit = heading.results.find((r) => r.doc === "en:owners/getting-started/create-your-store");
    expect(hit?.href).toBe("/docs/owners/getting-started/create-your-store#follow-the-setup-steps");
    expect(hit?.headings).toEqual(["Follow the setup steps"]);
    expect(hit?.snippet.some((p) => p.hit && /^setup$/i.test(p.text))).toBe(true);
  });

  it("finds a reference item by its name, with its code, at its heading in the generated reference (E4)", async () => {
    const op = await ask("products.get");
    expect(op.results[0]).toMatchObject({ doc: "ref:operation:products.get", item: "operation", kind: "reference", code: "products.get · GET /api/admin/v1/products/{id}" });
    expect(op.results[0].href).toBe("/docs/reference/admin-api/products#products-get");
    expect(op.results[0].section).toEqual({ path: "developers/reference", title: "API reference" });
    const errors = await ask("rate_limited");
    expect(docsOf(errors)).toContain("ref:error:rate_limited");
    expect(errors.results.find((r) => r.doc === "ref:error:rate_limited")?.href).toBe("/docs/reference/errors#rate-limited");
    // The written guide and the generated page both answer "scopes".
    const scopes = await ask("scopes");
    expect(docsOf(scopes).slice(0, 3)).toEqual(expect.arrayContaining(["en:developers/overview/authentication", "en:reference/scopes"]));
    expect(scopes.results.find((r) => r.doc === "en:developers/overview/authentication")?.href).toBe("/docs/developers/overview/authentication#scopes");
    // The reference's own words that are no item's, such as how to check a webhook's signature.
    const signature = await ask("check the signature");
    expect(signature.results.find((r) => r.doc === "en:reference/webhooks")?.href).toMatch(/^\/docs\/reference\/webhooks#signature/);
  });

  it("lists the generated reference as one section of the developers' track (E4)", async () => {
    const listed = await ask("", { filters: { ...NO_FILTERS, section: "developers/reference" } });
    expect(listed.match).toBe("browse");
    expect(listed.results[0]).toMatchObject({ doc: "en:reference", href: "/docs/reference", kind: "reference" });
    expect(listed.results.every((r) => r.kind === "reference" && r.track === "developers")).toBe(true);
    const webhooks = await ask("", { filters: { ...NO_FILTERS, section: "developers/reference", area: ["webhooks"] } });
    expect(docsOf(webhooks)).toContain("ref:topic:order.paid");
  });

  it("finds a title through a typo, and words being typed by their start", async () => {
    const typo = await ask("authentcation");
    expect(docsOf(typo)).toContain("en:developers/overview/authentication");
    const typing = await ask("idempot");
    expect(docsOf(typing)).toContain("en:developers/overview/authentication");
  });

  it("finds VAT as mva and moms through the synonyms, in each language's own words", async () => {
    // Within the getting-started section, where the page that names VAT only as "mva" is not crowded out by the tax section's own.
    const norwegian = await ask("vat", { filters: { ...NO_FILTERS, lang: ["nb"], section: "owners/getting-started" } });
    expect(docsOf(norwegian)).toContain("nb:owners/getting-started/your-first-product");
    const mva = await ask("mva", { filters: { ...NO_FILTERS, lang: ["en"], section: "owners/getting-started" } });
    expect(docsOf(mva)).toContain("en:owners/getting-started/your-first-product");
    const marked = mva.results.find((r) => r.doc === "en:owners/getting-started/your-first-product");
    expect(marked?.snippet.filter((p) => p.hit).map((p) => p.text)).toContain("VAT");
  });

  it("searches Norwegian pages with the Norwegian dictionary and links them under /no", async () => {
    const answer = await ask("nettbutikken", { filters: { ...NO_FILTERS, lang: ["nb"] } });
    expect(answer.results[0]).toMatchObject({
      doc: "nb:owners/getting-started/create-your-store",
      href: "/no/docs/owners/getting-started/create-your-store",
      title: "Lag nettbutikken din",
      section: { path: "owners/getting-started", title: "Kom i gang" },
    });
    // Stemmed: an inflected form finds the same page.
    expect(docsOf(await ask("produktene", { filters: { ...NO_FILTERS, lang: ["nb"] } }))).toContain("nb:owners/getting-started/your-first-product");
  });

  it("falls back to pages with some of the words when none has them all, and finds nothing for nonsense", async () => {
    const some = await ask("token zyxwvut");
    expect(some.match).toBe("any");
    expect(docsOf(some)).toContain("en:developers/overview/authentication");
    const none = await ask("qqqzzzxxx");
    expect(none).toMatchObject({ match: "none", found: 0, total: 0, results: [], next: null });
  });
});

describe("filters, counts, orders and pages (D443)", () => {
  it("counts every filter's values and narrows by them", async () => {
    const all = await ask("token");
    const track = Object.fromEntries(all.facets.track.map((f) => [f.value, f.count]));
    expect(track.developers).toBeGreaterThan(0);
    const reference = await ask("token", { filters: { ...NO_FILTERS, kind: ["reference"] } });
    expect(reference.results.every((r) => r.kind === "reference")).toBe(true);
    expect(reference.total).toBe(all.facets.kind.find((f) => f.value === "reference")?.count);
    // The kind's own counts stay as they were: choosing another kind adds to the list.
    expect(reference.facets.kind).toEqual(all.facets.kind.map((f) => ({ ...f, selected: f.value === "reference" })));
    expect(reference.found).toBe(all.found);
    const owners = await ask("token", { filters: { ...NO_FILTERS, track: ["owners"], area: ["errors"] } });
    expect(owners.total).toBe(0);
    expect(owners.match).toBe("none");
    expect(owners.found).toBeGreaterThan(0);
  });

  it("lists a section's pages without words, in the docs' order or another, and its filters", async () => {
    const section = { ...NO_FILTERS, section: "owners/getting-started", lang: ["en" as const] };
    const reading = await ask("", { filters: section });
    expect(reading.match).toBe("browse");
    expect(docsOf(reading)).toEqual(["en:owners/getting-started/create-your-store", "en:owners/getting-started/find-your-way", "en:owners/getting-started/your-first-product", "en:owners/getting-started/choose-a-plan"]);
    expect(reading.results[0].snippet.map((p) => p.text).join("")).toBe("Sign up, confirm your email address and follow the setup steps until your store is ready to open.");
    const az = await ask("", { filters: section, sort: "title" });
    expect(docsOf(az)).toEqual(["en:owners/getting-started/your-first-product", "en:owners/getting-started/choose-a-plan", "en:owners/getting-started/create-your-store", "en:owners/getting-started/find-your-way"]);
    const tutorials = await ask("", { filters: { ...section, kind: ["tutorial"] } });
    expect(tutorials.total).toBe(2);
  });

  it("orders by most read from the counted reads, and by recently checked with the reference last", async () => {
    await db().execute(sql`insert into commerce.docs_reads (path, lang, day, reads) values ('owners/getting-started/your-first-product', 'en', current_date, 7), ('owners/getting-started/create-your-store', 'en', current_date - 200, 99)`);
    const read = await ask("", { filters: { ...NO_FILTERS, section: "owners/getting-started", lang: ["en"] }, sort: "read" });
    // Reads older than 90 days do not count.
    expect(docsOf(read)[0]).toBe("en:owners/getting-started/your-first-product");
    const checked = await ask("token", { sort: "checked" });
    const firstReference = checked.results.findIndex((r) => r.checked === null);
    expect(checked.results.slice(0, Math.max(firstReference, 0)).every((r) => r.checked !== null)).toBe(true);
    await db().execute(sql`delete from commerce.docs_reads`);
  });

  it("pages twenty at a time with a cursor, without repeating a document, and refuses another order's cursor", async () => {
    const first = await ask("", { filters: { ...NO_FILTERS, track: ["developers"] } });
    expect(first.results).toHaveLength(20);
    expect(first.total).toBeGreaterThan(40);
    const second = await ask("", { filters: { ...NO_FILTERS, track: ["developers"] }, cursor: first.next });
    expect(second.results).toHaveLength(20);
    expect(docsOf(second).filter((d) => docsOf(first).includes(d))).toEqual([]);
    const refused = await search.searchDocs({ q: "", filters: NO_FILTERS, sort: "title", cursor: first.next });
    expect(refused).toEqual({ ok: false, problem: "cursor" });
  });
});

describe("search by meaning, merged by rank (D443)", () => {
  it("finds parts closest in meaning with the platform's AI, beside the words, and none without it", async () => {
    platformAi = { provider: "openai", source: "platform", apiUrl: "https://ai.example", apiKey: "k", space: "toy|4", embeddingModel: "toy", minSimilarity: 0.3 } as unknown as AiConnection;
    while ((await search.refreshDocsIndex()).embedded > 0);
    // No page holds "kickstart" or "webshop", but the stand-in reads them as about making a store.
    const answer = await ask("kickstart a webshop", { filters: { ...NO_FILTERS, track: ["owners"], lang: ["en"] } });
    expect(answer.meaning).toBe(true);
    expect(answer.match).toBe("all");
    expect(docsOf(answer)).toEqual(["en:owners/getting-started/create-your-store"]);
    platformAi = null;
    const words = await ask("kickstart a webshop", { filters: { ...NO_FILTERS, track: ["owners"], lang: ["en"] } });
    expect(words.meaning).toBe(false);
  });
});

describe("the routes (D443)", () => {
  it("answers a search to any caller, with no cookie and no cache, and refuses a cursor that is not one", async () => {
    const response = await GET(new Request("http://localhost:3000/api/docs/search?q=create+your+store&lang=en", { headers: headersFrom({ origin: "https://elsewhere.example" }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as DocsSearchAnswer;
    expect(body.results[0].doc).toBe("en:owners/getting-started/create-your-store");
    expect(body.filters.lang).toEqual(["en"]);
    expect((await GET(new Request("http://localhost:3000/api/docs/search?q=x&cursor=!!", { headers: headersFrom() }))).status).toBe(400);
  });

  it("refuses a visitor past their budget, and refuses rather than allows when counting fails", async () => {
    expect(FAIL_CLOSED.has("docs_search")).toBe(true);
    const headers = headersFrom();
    const key = budgetVisitor(new Headers(headers));
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${budgetBuckets("docs_search", key).visitor}, date_trunc('minute', now()), ${BUDGETS.docs_search.visitor})
      on conflict (store_id, bucket, "window") do update set count = excluded.count
    `);
    const refused = await GET(new Request("http://localhost:3000/api/docs/search?q=token", { headers }));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts a miss for the gap list once an hour a reader, from the docs' own pages, never personal-looking words", async () => {
    const post = (body: unknown, headers: Record<string, string>) =>
      miss.POST(new Request("http://localhost:3000/api/docs/search/miss", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
    const reader = headersFrom({ origin: "http://localhost:3000" });
    expect((await post({ q: `  Gift   Cards ${run}`, lang: "en" }, reader)).status).toBe(204);
    expect((await post({ q: `gift cards ${run}`, lang: "en" }, reader)).status).toBe(204);
    expect((await post({ q: `gift cards ${run}`, lang: "en" }, headersFrom({ origin: "http://localhost:3000" }))).status).toBe(204);
    const [row] = await db().execute<Row>(sql`select query, lang, misses from commerce.docs_search_misses where query = ${`gift cards ${run}`}`);
    expect(row).toEqual({ query: `gift cards ${run}`, lang: "en", misses: 2 });
    // Another site's page is refused; an email address is never kept.
    expect((await post({ q: "elsewhere", lang: "en" }, headersFrom({ origin: "https://elsewhere.example" }))).status).toBe(403);
    await post({ q: "refund ola@example.com", lang: "en" }, headersFrom({ origin: "http://localhost:3000" }));
    expect(await db().execute(sql`select 1 from commerce.docs_search_misses where query like '%@%'`)).toHaveLength(0);
    // The table holds nothing about the reader.
    const columns = await db().execute<Row>(sql`select column_name from information_schema.columns where table_schema = 'commerce' and table_name = 'docs_search_misses' order by ordinal_position`);
    expect(columns.map((c) => c.column_name)).toEqual(["query", "lang", "misses", "first_at", "last_at", "guide_misses"]);
    // The platform's admins read the list, most often first, and take one off it.
    const list = await search.listDocsMisses();
    expect(list.find((m) => m.query === `gift cards ${run}`)?.misses).toBe(2);
    const [admin] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`docs-search-${run}@example.com`}, 'Platform', true) returning id`);
    expect(await search.removeDocsMiss({ id: String(admin.id) }, `gift cards ${run}`, "en")).toBe(true);
    expect(await search.removeDocsMiss({ id: String(admin.id) }, `gift cards ${run}`, "en")).toBe(false);
    const [audited] = await db().execute<Row>(sql`select details from commerce.audit_log where account_id = ${String(admin.id)}::uuid and action = 'platform.docs_miss_removed'`);
    expect(audited.details).toEqual({ lang: "en", misses: 2 });
  });

  it("counts a page read once an hour a reader, only for a page the docs have", async () => {
    const post = (body: unknown, headers: Record<string, string>) =>
      read.POST(new Request("http://localhost:3000/api/docs/read", { method: "POST", headers: { "content-type": "text/plain", ...headers }, body: JSON.stringify(body) }));
    const reader = headersFrom({ origin: "http://localhost:3000" });
    expect((await post({ path: "developers/overview/authentication", lang: "en" }, reader)).status).toBe(204);
    await post({ path: "developers/overview/authentication", lang: "en" }, reader);
    await post({ path: "developers/overview/authentication", lang: "en" }, headersFrom({ origin: "http://localhost:3000" }));
    await post({ path: "developers/overview/nowhere", lang: "en" }, headersFrom({ origin: "http://localhost:3000" }));
    await post({ path: "developers/overview/authentication", lang: "nb" }, headersFrom({ origin: "http://localhost:3000" }));
    expect((await post({ path: "developers/overview/authentication", lang: "en" }, headersFrom({ origin: "https://elsewhere.example" }))).status).toBe(403);
    // A page of the generated reference (E4) is counted as an article is; not in Norwegian, which it is not written in.
    await post({ path: "reference/webhooks/order-paid", lang: "en" }, headersFrom({ origin: "http://localhost:3000" }));
    await post({ path: "reference/webhooks/order-paid", lang: "nb" }, headersFrom({ origin: "http://localhost:3000" }));
    const rows = await db().execute<Row>(sql`select path, lang, reads from commerce.docs_reads order by path`);
    expect(rows).toEqual([
      { path: "developers/overview/authentication", lang: "en", reads: 2 },
      { path: "reference/webhooks/order-paid", lang: "en", reads: 1 },
    ]);
  });

  it("forgets reads after 90 days and misses unseen for 180", async () => {
    await db().execute(sql`insert into commerce.docs_reads (path, lang, day, reads) values ('changelog', 'en', current_date - 91, 3)`);
    await db().execute(sql`insert into commerce.docs_search_misses (query, lang, misses, first_at, last_at) values (${`old ${run}`}, 'en', 1, now() - interval '200 days', now() - interval '181 days')`);
    const pruned = await search.pruneDocsCounts();
    expect(pruned.reads).toBeGreaterThanOrEqual(1);
    expect(pruned.misses).toBeGreaterThanOrEqual(1);
    expect(await db().execute(sql`select 1 from commerce.docs_reads where day < current_date - 90`)).toHaveLength(0);
  });
});
