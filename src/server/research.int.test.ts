import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore } = await import("./trust-fixtures");
const { actingAs } = await import("./actor");
const research = await import("./research");
const { saveSearchSettings, searchSettings } = await import("./web-search-settings");
type Fetched = import("./replicate-fetch").Fetched;

type Row = Record<string, unknown>;

/**
 * Web research (D329, `docs/ai-autopilot.md` 13.6), with a stand-in for the search service and for page fetches: no search until a
 * platform admin sets the service; a search recorded as AI usage (the autopilot's inside its turns) and its results as sources; a
 * failed answer recorded as failed; the day's limit; a page read and kept; a note refused for an address nobody opened, and per store;
 * a comparison kept with its totals.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let admin: Awaited<ReturnType<typeof makeAccount>>;
const actor = () => ({ account: store.account, store: { id: store.id } as never });
const otherActor = () => ({ account: other.account, store: { id: other.id } as never });

const braveAnswer = {
  type: "search",
  web: { results: [{ title: "Coffee subscriptions in Norway", url: "https://coffee.example/abonnement", description: "From 249 kr a month.", age: "3 days ago" }] },
};
const okFetch = (async () => new Response(JSON.stringify(braveAnswer), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
const page = (html: string, contentType = "text/html"): ((url: string) => Promise<Fetched>) => async (url) => ({ ok: true, url, status: 200, contentType, bytes: new TextEncoder().encode(html) });
const usageOf = (storeId: string) => db().execute<Row>(sql`select kind, feature, searches, failed, provider, model from commerce.ai_usage where store_id = ${storeId}::uuid and kind = 'search' order by created_at`);

beforeAll(async () => {
  store = await makeStore("research");
  other = await makeStore("research-other");
  admin = await makeAccount("research-admin", { platformAdmin: true });
  await db().execute(sql`delete from commerce.search_settings where store_id is null`);
});

afterAll(async () => {
  for (const id of [store.id, other.id]) {
    await db().execute(sql`delete from commerce.research_notes where store_id = ${id}::uuid`);
    await db().execute(sql`delete from commerce.research_sources where store_id = ${id}::uuid`);
    await db().execute(sql`delete from commerce.ai_usage where store_id = ${id}::uuid`);
  }
  await db().execute(sql`delete from commerce.search_settings where store_id is null`);
  await closeDb();
});

describe("the search service", () => {
  it("is not there until a platform admin sets it, with a key only its hint shows", async () => {
    await expect(research.searchWeb(actor(), { query: "coffee", count: 5, freshness: "any" }, { fetch: okFetch })).rejects.toThrow("Web search is not set up");
    await expect(saveSearchSettings(store.account, { provider: "brave", apiKey: "BSAsecret1234" })).rejects.toThrow("Only a platform admin");
    await expect(saveSearchSettings(admin, { provider: "brave", apiKey: "" })).rejects.toThrow("Paste the search service's API key");
    await saveSearchSettings(admin, { provider: "brave", apiKey: "BSAsecret1234" });
    expect(await searchSettings()).toEqual({ provider: "brave", keyHint: "…1234", enabled: true });
    const [row] = await db().execute<Row>(sql`select api_key_encrypted from commerce.search_settings where store_id is null`);
    expect(String(row.api_key_encrypted)).not.toContain("BSAsecret1234");
    // An empty key keeps the saved one.
    await saveSearchSettings(admin, { provider: "brave", apiKey: "", enabled: true });
    expect((await searchSettings())?.keyHint).toBe("…1234");
  });
});

describe("a search", () => {
  it("answers the results, sends the key to the service's host, and is recorded as usage and sources", async () => {
    const asked: { url: string; key: string | null }[] = [];
    const spy = (async (url: string, init?: RequestInit) => {
      asked.push({ url, key: new Headers(init?.headers).get("X-Subscription-Token") });
      return okFetch(url, init);
    }) as typeof fetch;
    const { results } = await research.searchWeb(actor(), { query: "coffee subscription norway", count: 5, country: "NO", freshness: "month" }, { fetch: spy });
    expect(results).toEqual([{ title: "Coffee subscriptions in Norway", url: "https://coffee.example/abonnement", snippet: "From 249 kr a month.", age: "3 days ago" }]);
    expect(new URL(asked[0].url).hostname).toBe("api.search.brave.com");
    expect(asked[0].key).toBe("BSAsecret1234");
    expect(await usageOf(store.id)).toEqual([{ kind: "search", feature: "web_research", searches: 1, failed: 0, provider: "brave", model: "web-search" }]);
    const [source] = await db().execute<Row>(sql`select kind, url, title from commerce.research_sources where store_id = ${store.id}::uuid`);
    expect(source).toEqual({ kind: "search", url: "https://coffee.example/abonnement", title: "Coffee subscriptions in Norway" });
  });

  it("counts as the autopilot's inside its turns, and a failed answer as failed", async () => {
    await actingAs("autopilot", () => research.searchWeb(actor(), { query: "coffee", count: 3, freshness: "any" }, { fetch: okFetch }));
    const busy = (async () => new Response("slow down", { status: 429 })) as typeof fetch;
    await expect(research.searchWeb(actor(), { query: "coffee", count: 3, freshness: "any" }, { fetch: busy })).rejects.toThrow("busy");
    const rows = await usageOf(store.id);
    expect(rows.slice(1).map((r) => [r.feature, r.searches, r.failed])).toEqual([
      ["autopilot", 1, 0],
      ["web_research", 0, 1],
    ]);
  });

  it("stops at the day's limit", async () => {
    await db().execute(sql`
      insert into commerce.ai_usage (store_id, source, provider, model, kind, feature, searches) values (${other.id}::uuid, 'platform', 'brave', 'web-search', 'search', 'web_research', 100)
    `);
    await expect(research.searchWeb(otherActor(), { query: "coffee", count: 3, freshness: "any" }, { fetch: okFetch })).rejects.toThrow("web searches are used");
  });
});

describe("reading a page", () => {
  it("answers its readable text and keeps it as a source; a file that is not a page is refused", async () => {
    const html = `<html><head><title>Abonnement</title></head><body><nav>Menu</nav><main><h1>Kaffe hver måned</h1><p>Fra 249 kr i måneden, fri frakt. ${"Mer tekst. ".repeat(30)}</p></main></body></html>`;
    const read = await research.readWebPage(actor(), { url: "https://coffee.example/pris" }, { fetchPage: page(html) });
    expect(read).toMatchObject({ url: "https://coffee.example/pris", title: "Abonnement", cut: false });
    expect(read.text.startsWith("Kaffe hver måned\nFra 249 kr i måneden, fri frakt.")).toBe(true);
    expect(read.text).not.toContain("Menu");
    const [kept] = await db().execute<Row>(sql`select kind, title, text_hash from commerce.research_sources where store_id = ${store.id}::uuid and url = 'https://coffee.example/pris'`);
    expect(kept).toMatchObject({ kind: "page", title: "Abonnement" });
    expect(String(kept.text_hash)).toMatch(/^[0-9a-f]{64}$/);
    await expect(research.readWebPage(actor(), { url: "https://coffee.example/file.pdf" }, { fetchPage: page("%PDF", "application/pdf") })).rejects.toThrow("not a page that can be read");
    await expect(research.readWebPage(actor(), { url: "javascript:alert(1)" }, { fetchPage: page("") })).rejects.toThrow("full address");
  });
});

describe("notes and comparisons", () => {
  it("keep a note only for addresses the store searched or read, never another store's", async () => {
    await expect(research.saveResearchNote(actor(), { topic: "Prices", finding: "Subscriptions cost 249 kr.", sources: ["https://never.example/opened"] })).rejects.toThrow(
      "not searched or read",
    );
    await research.saveResearchNote(actor(), { topic: "Prices", finding: "Subscriptions start at 249 kr a month.", sources: ["https://coffee.example/pris#top", "https://coffee.example/abonnement"] });
    const [note] = await research.listResearchNotes(actor(), { topic: "249", limit: 5 });
    expect(note).toMatchObject({ kind: "note", topic: "Prices", sources: ["https://coffee.example/pris", "https://coffee.example/abonnement"] });
    await expect(research.saveResearchNote(otherActor(), { topic: "Prices", finding: "Copied.", sources: ["https://coffee.example/pris"] })).rejects.toThrow("not searched or read");
    expect(await research.listResearchNotes(otherActor(), { limit: 5 })).toEqual([]);
  });

  it("keep a comparison with its totals and ranking worked out in code", async () => {
    const { comparison } = await research.compareAndKeep(actor(), {
      topic: "What to sell first",
      criteria: [
        { name: "Demand", weight: 5 },
        { name: "Margin", weight: 2 },
      ],
      options: [
        { name: "Subscriptions", scores: { Demand: 4, Margin: 3 }, reason: "" },
        { name: "Single bags", scores: { Demand: 5, Margin: 1 }, reason: "" },
      ],
      sources: ["https://coffee.example/abonnement"],
    });
    // 5*5 + 1*2 = 27 and 4*5 + 3*2 = 26, of 35.
    expect(comparison.options.map((o) => [o.name, o.total, o.rank])).toEqual([
      ["Single bags", 27, 1],
      ["Subscriptions", 26, 2],
    ]);
    const [kept] = await research.listResearchNotes(actor(), { topic: "What to sell first", limit: 1 });
    expect(kept).toMatchObject({ kind: "comparison", finding: "Ranked by weighted score: 1. Single bags (77 %), 2. Subscriptions (74 %)." });
  });
});
