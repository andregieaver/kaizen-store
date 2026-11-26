import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
// The platform's host, so a store without a domain of its own is found at its path there (`/s/{slug}`).
process.env.SITE_URL = "https://kaizenaflow.com";

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore } = await import("./trust-fixtures");
const search = await import("./market-search");
const { addRival } = await import("./market-rivals");
const { marketCheck } = await import("./market-check");
const { marketCheckTool } = await import("./market-check-tool");
const { saveSearchSettings } = await import("./web-search-settings");
const { getStore } = await import("./stores");
const { customPeriod } = await import("@/lib/analytics-period");

type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;

/**
 * Where a store and its rivals come up in search (D905 M5b) against the database, with a stand-in for the search service: words followed
 * and refused as the rules say; a word waiting while search is not set up; searched by the watcher, the store found at its path on the
 * platform's host and a rival at its host; the place before kept a month on; the findings and the AI manager's facts; a word removed.
 */

let store: Store;
let account: { id: string };
const actor = () => ({ account, store });
const today = () => new Date().toISOString().slice(0, 10);

/** The search service's answer: these addresses, in this order. */
const answering = (urls: string[]) =>
  (async () =>
    new Response(JSON.stringify({ type: "search", web: { results: urls.map((url, i) => ({ title: `Result ${i + 1}`, url, description: "" })) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

beforeAll(async () => {
  const made = await makeStore("search-words");
  account = made.account;
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${made.id}::uuid`);
  store = (await getStore(made.slug))!;
  await addRival(actor(), { market: "NO", name: "Linnet", address: "https://www.linnet.no" });
  await db().execute(sql`delete from commerce.search_settings where store_id is null`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.search_settings where store_id is null`);
  await closeDb();
});

describe("words a store follows in search (D905 M5b)", () => {
  it("are followed by a person in one of the store's countries, and refused otherwise", async () => {
    const refused = async (input: { market: string; term: string }) => {
      try {
        await search.addSearchTerm(actor(), input);
        return null;
      } catch (error) {
        return error instanceof search.SearchTermError ? error.problem : String(error);
      }
    };
    expect(await search.addSearchTerm(actor(), { market: "no", term: "  Linen   Apron " })).toMatchObject({ term: "linen apron" });
    await search.addSearchTerm(actor(), { market: "NO", term: "linforkle" });
    expect(await refused({ market: "NO", term: "Linen apron" })).toBe("exists");
    expect(await refused({ market: "DE", term: "schürze" })).toBe("market");
    expect(await refused({ market: "NO", term: "x" })).toBe("term");
    await db().execute(sql`
      insert into commerce.search_terms (store_id, market_code, term) select ${store.id}::uuid, 'NO', 'filler ' || n from generate_series(1, 8) n`);
    expect(await refused({ market: "NO", term: "one too many" })).toBe("full");
    await db().execute(sql`delete from commerce.search_terms where store_id = ${store.id}::uuid and term like 'filler %'`);
  });

  it("wait while search is not set up, and say so", async () => {
    expect(await search.watchSearchTerms({ fetch: answering([]) })).toEqual({ searched: 0, waiting: 2 });
    const terms = await search.listSearchTerms(store.id);
    expect(terms.map((t) => [t.term, t.problem, t.checkedAt])).toEqual([
      ["linen apron", "off", null],
      ["linforkle", "off", null],
    ]);
  });

  it("are searched by the watcher, the store found at its path on the platform's host and each rival at its host", async () => {
    const admin = await makeAccount("search-admin", { platformAdmin: true });
    await saveSearchSettings(admin, { provider: "brave", apiKey: "BSAsecret1234" });
    // A day on, both are tried again.
    await db().execute(sql`update commerce.search_terms set tried_at = now() - interval '2 days' where store_id = ${store.id}::uuid`);
    const results = ["https://elsewhere.no/a", "https://www.linnet.no/forkle", "https://kaizenaflow.com/s/other/no", `https://kaizenaflow.com/s/${store.slug}/no/p/apron`];
    expect(await search.watchSearchTerms({ fetch: answering(results) })).toEqual({ searched: 2, waiting: 0 });
    const [apron] = await search.listSearchTerms(store.id);
    expect(apron).toMatchObject({ term: "linen apron", own: 4, previous: null, problem: null, rivals: [{ name: "Linnet", host: "linnet.no", position: 2 }] });
    // Searched now: nothing is due for a month.
    expect(await search.watchSearchTerms({ fetch: answering(results) })).toEqual({ searched: 0, waiting: 0 });
    const check = await marketCheck(store, customPeriod(today(), today()), { now: new Date() });
    expect(check.findings.filter((f) => f.kind === "search_behind")).toContainEqual({ kind: "search_behind", market: "NO", term: "linen apron", rivalName: "Linnet", theirs: 2, yours: 4 });
  });

  it("keep the store's place before when searched again a month on, and say what it now means", async () => {
    await db().execute(sql`update commerce.search_terms set checked_at = now() - interval '31 days', tried_at = now() - interval '31 days' where store_id = ${store.id}::uuid`);
    await search.watchSearchTerms({ fetch: answering([`https://kaizenaflow.com/s/${store.slug}`, "https://other.no", "https://linnet.no/"]) });
    const [apron] = await search.listSearchTerms(store.id);
    expect(apron).toMatchObject({ own: 1, previous: 4, rivals: [{ name: "Linnet", position: 3 }] });
    const check = await marketCheck(store, customPeriod(today(), today()), { now: new Date() });
    expect(check.findings.find((f) => f.kind === "search_ahead" && f.term === "linen apron")).toEqual({ kind: "search_ahead", market: "NO", term: "linen apron", yours: 1 });
    const tool = await marketCheckTool({ store } as never, { days: 30 });
    expect(tool.search_words.find((w) => w.word === "linen apron")).toEqual({
      word: "linen apron",
      country: "NO",
      your_place: 1,
      place_before: 4,
      rivals: [{ name: "Linnet", place: 3 }],
      searched: today(),
    });
  });

  it("are removed by a person, only the store's own", async () => {
    const [apron] = await search.listSearchTerms(store.id);
    expect(await search.removeSearchTerm(actor(), apron.id)).toBe(true);
    expect(await search.removeSearchTerm(actor(), apron.id)).toBe(false);
    expect((await search.listSearchTerms(store.id)).map((t) => t.term)).toEqual(["linforkle"]);
  });
});
