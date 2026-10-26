import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { searchRedirect } from "@/lib/search-rules";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const search = await import("./search");
const rules = await import("./search-rules");
const { getStore } = await import("./stores");

/** Search merchandising (wave 6 unit F2, D324, `docs/wave-6-catalogue.md` F.2). */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
type Made = { id: string; slug: string; product: Map<string, string>; term: Map<string, string> };
const made: Made[] = [];
let accountId: string;

async function makeStore(slug: string): Promise<Made> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const id = String(store.id);
  const product = new Map<string, string>();
  for (const row of await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${id}::uuid`)) product.set(String(row.handle), String(row.id));
  const term = new Map<string, string>();
  for (const row of await db().execute<Row>(sql`select id, slug from commerce.terms where store_id = ${id}::uuid and content_type = 'product'`)) term.set(String(row.slug), String(row.id));
  const store_ = { id, slug, product, term };
  made.push(store_);
  return store_;
}

const writer = async (store: Made) => ({ account: { id: accountId }, store: (await getStore(store.slug))! });

/** The handles a store's search shows, in order. */
const shown = async (store: Made, query: string) => {
  const found = await search.searchProducts({ storeId: store.id, market: no }, query, null, null);
  return found.products.map((product) => product.handle);
};

beforeAll(async () => {
  await makeStore(`rules-${run}`);
  await makeStore(`rules-other-${run}`);
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`rules-account-${run}@example.com`}, 'R') returning id`);
  accountId = String(account.id);
});

afterAll(async () => {
  await closeDb();
});

describe("search merchandising", () => {
  it("puts a pinned product first for its search, also one the search did not find", async () => {
    const [store] = made;
    const before = await shown(store, "keramikkopp");
    expect(before[0]).toBe("demo-keramikkopp");
    expect(before).not.toContain("demo-notatbok");
    const saved = await rules.saveRule(await writer(store), { action: "pin", productId: store.product.get("demo-notatbok"), queries: ["keramikkopp"] });
    expect(saved).toMatchObject({ ok: true });
    expect((await shown(store, "keramikkopp")).slice(0, 2)).toEqual(["demo-notatbok", "demo-keramikkopp"]);
    // Only for the searches it names; another store's search is unchanged.
    expect(await shown(store, "bordlampe")).not.toContain("demo-notatbok");
    expect(await shown(made[1], "keramikkopp")).toEqual(before);
  });

  it("moves a category's products up and a product down, in every search", async () => {
    const [store] = made;
    const all = await shown(store, "demo");
    expect(all.length).toBeGreaterThan(2);
    const w = await writer(store);
    const up = await rules.saveRule(w, { action: "boost", termId: store.term.get("belysning") });
    const down = await rules.saveRule(w, { action: "bury", productId: store.product.get(all[0]) });
    expect(up).toMatchObject({ ok: true });
    expect(down).toMatchObject({ ok: true });
    const moved = await shown(store, "demo");
    expect(moved[0]).toBe("demo-bordlampe");
    expect(moved.at(-1)).toBe(all[0] === "demo-bordlampe" ? moved.at(-1) : all[0]);
    expect([...moved].sort()).toEqual([...all].sort());
    for (const result of [up, down]) if (result.ok) await rules.deleteRule(w, result.id);
  });

  it("sends a search to a page of the store, read as the store's own address", async () => {
    const [store] = made;
    const w = await writer(store);
    expect(await rules.saveRule(w, { action: "redirect", target: "https://example.org/sale", queries: ["salg"] })).toMatchObject({
      ok: false,
      problems: [{ code: "target", reason: "target.external" }],
    });
    expect(await rules.saveRule(w, { action: "redirect", target: "/no/category/hjem", queries: ["salg"], match: "exact" })).toMatchObject({ ok: true });
    const storeRules = await rules.rulesOf(store.id);
    expect(searchRedirect(storeRules, "Salg")).toBe("/category/hjem");
    expect(searchRedirect(storeRules, "stort salg")).toBeNull();
    // Logged as sent on: neither found nor missed.
    await search.logRedirectedSearch({ storeId: store.id, market: no }, "salg");
    const stats = await search.searchStats(store.id);
    expect(stats.zero.map((row) => row.query)).not.toContain("salg");
    expect(stats.top.find((row) => row.query === "salg")).toMatchObject({ redirected: true, results: 0 });
    expect(stats.zeroRate).toBe(0);
  });

  it("refuses another store's product or category, and what an action needs", async () => {
    const [store, other] = made;
    const w = await writer(store);
    expect(await rules.saveRule(w, { action: "pin", productId: other.product.get("demo-notatbok"), queries: ["x"] })).toEqual({ ok: false, problems: [{ code: "product" }] });
    expect(await rules.saveRule(w, { action: "boost", termId: other.term.get("papir") })).toEqual({ ok: false, problems: [{ code: "term" }] });
    expect(await rules.saveRule(w, { action: "pin", productId: store.product.get("demo-notatbok"), queries: [] })).toEqual({
      ok: false,
      problems: [{ code: "queries_needed" }],
    });
    // Another store cannot delete a rule of this one.
    const [first] = await rules.rulesOf(store.id);
    expect(await rules.deleteRule(await writer(other), first.id)).toBe(false);
    const actions = await db().execute<Row>(sql`select distinct action from commerce.audit_log where store_id = ${store.id}::uuid and action like 'search.rule%'`);
    expect(actions.map((row) => row.action).sort()).toEqual(["search.rule_deleted", "search.rule_saved"]);
  });

  it("keeps at most 200 rules a store", async () => {
    const [, other] = made;
    await db().execute(sql`
      insert into commerce.search_rules (store_id, action, product_id, queries)
      select ${other.id}::uuid, 'pin', ${other.product.get("demo-notatbok")}::uuid, array['q' || n] from generate_series(1, 200) n
    `);
    expect(await rules.saveRule(await writer(other), { action: "boost", productId: other.product.get("demo-notatbok") })).toEqual({ ok: false, problems: [{ code: "max" }] });
    await expect(
      db().execute(sql`insert into commerce.search_rules (store_id, action, product_id) values (${other.id}::uuid, 'boost', ${other.product.get("demo-notatbok")}::uuid)`),
    ).rejects.toThrow();
    await db().execute(sql`delete from commerce.search_rules where store_id = ${other.id}::uuid`);
  });

  it("goes with the store when it is copied, pointing at the copy's products and terms", async () => {
    const [store] = made;
    const w = await writer(store);
    await rules.saveRule(w, { action: "bury", termId: store.term.get("papir"), queries: ["papir"] });
    const before = await rules.rulesOf(store.id);
    for (const copy of [
      sql`select commerce.duplicate_store(${store.id}::uuid, ${`rules-copy-${run}`}, 'Copy', ${accountId}::uuid, null, null, null) as id`,
      sql`select commerce.clone_store(${store.id}::uuid, ${`rules-clone-${run}`}, 'Kopi', ${accountId}::uuid) as id`,
    ]) {
      const [row] = await db().execute<Row>(copy);
      const copyId = String(row.id);
      const after = await rules.rulesOf(copyId);
      expect(after.map((rule) => [rule.action, rule.queries, rule.target])).toEqual(before.map((rule) => [rule.action, rule.queries, rule.target]));
      const own = await db().execute<Row>(sql`
        select count(*)::int as n from commerce.search_rules r
        where r.store_id = ${copyId}::uuid
          and (r.product_id is null or exists (select 1 from commerce.products p where p.store_id = r.store_id and p.id = r.product_id))
          and (r.term_id is null or exists (select 1 from commerce.terms t where t.store_id = r.store_id and t.id = r.term_id))
      `);
      expect(own[0].n).toBe(before.length);
    }
  });
});
