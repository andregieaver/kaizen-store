import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { REDIRECT_BULK_DELETE_MAX } from "@/lib/data-limits";

import { makeStore } from "./invoice-test-fixture";
import { auditActions, redirectFixture, redirectRowsOf, renameProduct, renameTerm, type RedirectFixture } from "./redirect-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const redirects = await import("./redirects");

type Row = Record<string, unknown>;

/**
 * The redirect manager's service (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2, 6.1 R2, 6.3 S1): add, edit, delete and search manual redirects of a
 * store, the one check (live sources, working pages, loops, chains, the limit), the keys, the other store, and the activity log written in the same
 * transaction. Only `redirects.ts` writes the table (a scan test holds that).
 */

let f: RedirectFixture;
let other: RedirectFixture;

beforeAll(async () => {
  f = await redirectFixture("redirects");
  other = await redirectFixture("redirects-other");
});

afterAll(async () => {
  await closeDb();
});

const ok = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

describe("adding a redirect", () => {
  it("saves a manual redirect in the normal form, says what it did and writes one entry with the two addresses", async () => {
    const saved = ok(await redirects.createRedirect(f.owner, { from: "/Collections/Shoes/", to: `/category/${f.category.slug}` }));
    expect(saved).toMatchObject({ source: "/collections/shoes", target: `/category/${f.category.slug}`, created: true, unchanged: false, replacedAutomatic: false });
    const [row] = await db().execute<Row>(sql`select kind, origin, created_by, target from commerce.redirects where store_id = ${f.fx.storeId}::uuid and source = '/collections/shoes'`);
    expect(row).toMatchObject({ kind: "manual", origin: "editor", created_by: f.owner.account.id, target: `/category/${f.category.slug}` });
    const log = await auditActions(f.fx.storeId, "redirect.created");
    expect(log).toHaveLength(1);
    expect(log[0].details).toEqual({ from: "/collections/shoes", to: `/category/${f.category.slug}` });
    expect(log[0].area).toBe("website");
  });

  it("replaces the target of a manual redirect from the same address (an edit) and reports a repeat as unchanged", async () => {
    ok(await redirects.createRedirect(f.owner, { from: "/old-edit", to: "/om-oss" }));
    const again = ok(await redirects.createRedirect(f.owner, { from: "/old-edit", to: "/om-oss" }));
    expect(again).toMatchObject({ created: false, unchanged: true });
    const replaced = ok(await redirects.createRedirect(f.owner, { from: "/old-edit", to: "/alle-produkter" }));
    expect(replaced).toMatchObject({ created: false, unchanged: false, target: "/alle-produkter" });
    expect(await auditActions(f.fx.storeId, "redirect.updated")).toHaveLength(1);
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.redirects where store_id = ${f.fx.storeId}::uuid and source = '/old-edit'`);
    expect(n.n).toBe(1);
  });

  it("refuses a live address as a source: an active product, a category, a tag, a page, an article and the products page", async () => {
    for (const from of [`/p/${f.product.handle}`, `/category/${f.category.slug}`, `/tag/${f.tag.slug}`, "/om-oss", "/blog/nye-produkter", "/products", "/blog"]) {
      const result = await redirects.createRedirect(f.owner, { from, to: "/somewhere" });
      expect(result, from).toMatchObject({ ok: false, code: "invalid" });
      expect((result as { findings: { code: string }[] }).findings.map((x) => x.code), from).toContain("source.live");
    }
  });

  it("accepts the address of a draft or an archived product (retiring a product and redirecting it is the common case)", async () => {
    await db().execute(sql`update commerce.products set status = 'draft' where store_id = ${f.fx.storeId}::uuid and id = ${f.product.id}::uuid`);
    const saved = ok(await redirects.createRedirect(f.owner, { from: `/p/${f.product.handle}`, to: "/alle-produkter" }));
    expect(saved.source).toBe(`/p/${f.product.handle}`);
    await redirects.deleteRedirects(f.owner, [saved.id]);
    await db().execute(sql`update commerce.products set status = 'active' where store_id = ${f.fx.storeId}::uuid and id = ${f.product.id}::uuid`);
  });

  it("refuses a working page, a country in the address, the front page, another website, itself and a loop, each with its finding", async () => {
    const codes = async (from: string, to: string) => ((await redirects.createRedirect(f.owner, { from, to })) as { findings: { code: string }[] }).findings.map((x) => x.code);
    expect(await codes("/cart", "/x")).toContain("source.reserved");
    expect(await codes("/checkout/anything", "/x")).toContain("source.reserved");
    expect(await codes("/no/old", "/x")).toContain("source.market_prefix");
    expect(await codes("/", "/x")).toContain("source.root");
    expect(await codes("/a", "https://evil.example/x")).toContain("target.external");
    expect(await codes("/self", "/self")).toContain("target.self");
    ok(await redirects.createRedirect(f.owner, { from: "/loop-a", to: "/loop-b" }));
    expect(await codes("/loop-b", "/loop-a")).toContain("target.loop");
    expect((await redirectRowsOf(f.fx.storeId)).some((r) => r.source === "/loop-b")).toBe(false);
  });

  it("stores the final destination when the target is itself redirected, and warns", async () => {
    ok(await redirects.createRedirect(f.owner, { from: "/chain-b", to: "/om-oss" }));
    const saved = ok(await redirects.createRedirect(f.owner, { from: "/chain-a", to: "/chain-b" }));
    expect(saved.target).toBe("/om-oss");
    expect(saved.findings.map((x) => x.code)).toContain("target.chain");
  });

  it("warns, and saves, when the target does not exist and when the source had a query string", async () => {
    const saved = ok(await redirects.createRedirect(f.owner, { from: "/gone?utm=1", to: "/not-a-page" }));
    expect(saved.source).toBe("/gone");
    expect(saved.findings.map((x) => x.code).sort()).toEqual(["source.query_dropped", "target.not_found"]);
  });

  it("replaces an automatic redirect from the same address, deleting it in the same step", async () => {
    await renameProduct(f.fx.storeId, f.product.id, `${f.product.handle}-new`);
    const automatic = (await redirectRowsOf(f.fx.storeId)).find((r) => r.source === `/p/${f.product.handle}`);
    expect(automatic).toMatchObject({ kind: "product", origin: "system" });
    const saved = ok(await redirects.createRedirect(f.owner, { from: `/p/${f.product.handle}`, to: "/alle-produkter" }));
    expect(saved.replacedAutomatic).toBe(true);
    const now = (await redirectRowsOf(f.fx.storeId)).filter((r) => r.source === `/p/${f.product.handle}`);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ kind: "manual", target: "/alle-produkter" });
    await redirects.deleteRedirects(f.owner, [saved.id]);
    await renameProduct(f.fx.storeId, f.product.id, f.product.handle);
  });

  it("refuses the 101st redirect when the limit is reached, naming the limit, and lets an edit of an existing one through", async () => {
    const fx = await redirectFixture("redirects-limit");
    ok(await redirects.createRedirect(fx.owner, { from: "/l1", to: "/om-oss" }, { limit: 2 }));
    ok(await redirects.createRedirect(fx.owner, { from: "/l2", to: "/om-oss" }, { limit: 2 }));
    const third = await redirects.createRedirect(fx.owner, { from: "/l3", to: "/om-oss" }, { limit: 2 });
    expect(third).toMatchObject({ ok: false, code: "invalid" });
    expect((third as { problems: string[] }).problems[0]).toContain("2");
    ok(await redirects.createRedirect(fx.owner, { from: "/l2", to: "/alle-produkter" }, { limit: 2 }));
  });

  it("refuses a member without the Website write key, another account's store and a visitor, and writes nothing", async () => {
    const before = (await redirectRowsOf(f.fx.storeId)).length;
    expect(await redirects.createRedirect(f.reader, { from: "/x1", to: "/om-oss" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await redirects.createRedirect(f.outsider, { from: "/x2", to: "/om-oss" })).toMatchObject({ ok: false, code: "forbidden" });
    expect((await redirectRowsOf(f.fx.storeId)).length).toBe(before);
  });

  it("writes nothing when the activity log cannot be written (the change and its entry are one transaction)", async () => {
    // A trigger that refuses this one entry: the redirect made in the same transaction must go with it.
    await db().execute(sql`
      create function commerce.test_refuse_redirect_entry() returns trigger language plpgsql as $$
      begin
        if new.action = 'redirect.created' and new.details ->> 'from' = '/never-saved' then raise exception 'the log is down' using errcode = 'check_violation'; end if;
        return new;
      end $$
    `);
    await db().execute(sql`create trigger test_refuse_redirect_entry before insert on commerce.audit_log for each row execute function commerce.test_refuse_redirect_entry()`);
    try {
      const result = await redirects.createRedirect(f.owner, { from: "/never-saved", to: "/om-oss" });
      expect(result).toMatchObject({ ok: false, code: "not_logged" });
      expect((await redirectRowsOf(f.fx.storeId)).some((r) => r.source === "/never-saved")).toBe(false);
    } finally {
      await db().execute(sql`drop trigger test_refuse_redirect_entry on commerce.audit_log`);
      await db().execute(sql`drop function commerce.test_refuse_redirect_entry()`);
    }
  });
});

describe("editing a redirect", () => {
  it("changes the target, the source or both, checked like a new one, and writes redirect.updated", async () => {
    const made = ok(await redirects.createRedirect(f.owner, { from: "/edit-me", to: "/om-oss" }));
    const target = ok(await redirects.updateRedirect(f.owner, made.id, { from: "/edit-me", to: "/alle-produkter" }));
    expect(target).toMatchObject({ source: "/edit-me", target: "/alle-produkter", unchanged: false });
    const moved = ok(await redirects.updateRedirect(f.owner, made.id, { from: "/edit-me-2", to: "/alle-produkter" }));
    expect(moved.source).toBe("/edit-me-2");
    expect((await redirectRowsOf(f.fx.storeId)).some((r) => r.source === "/edit-me")).toBe(false);
    expect(ok(await redirects.updateRedirect(f.owner, made.id, { from: "/edit-me-2", to: "/alle-produkter" })).unchanged).toBe(true);
    // A live source, a loop and another redirect's address are refused.
    expect(await redirects.updateRedirect(f.owner, made.id, { from: "/om-oss", to: "/alle-produkter" })).toMatchObject({ ok: false, code: "invalid" });
    ok(await redirects.createRedirect(f.owner, { from: "/other-one", to: "/om-oss" }));
    expect(await redirects.updateRedirect(f.owner, made.id, { from: "/other-one", to: "/alle-produkter" })).toMatchObject({ ok: false, code: "taken" });
    // A loop made by moving a redirect: /y goes to /w (which has no redirect yet), then this one is moved to /w and sent to /y.
    const second = ok(await redirects.createRedirect(f.owner, { from: "/w0", to: "/om-oss" }));
    ok(await redirects.createRedirect(f.owner, { from: "/y", to: "/w" }));
    const loop = await redirects.updateRedirect(f.owner, second.id, { from: "/w", to: "/y" });
    expect(loop).toMatchObject({ ok: false, code: "invalid" });
    expect((loop as { findings: { code: string }[] }).findings.map((x) => x.code)).toContain("target.loop");
  });

  it("does not edit an automatic redirect, another store's redirect or one that is not there", async () => {
    await renameTerm(f.fx.storeId, f.category.id, `${f.category.slug}-b`);
    const automatic = (await redirectRowsOf(f.fx.storeId)).find((r) => r.source === `/category/${f.category.slug}`)!;
    expect(await redirects.updateRedirect(f.owner, String(automatic.id), { from: "/x", to: "/om-oss" })).toMatchObject({ ok: false, code: "automatic" });
    const foreign = ok(await redirects.createRedirect(other.owner, { from: "/theirs", to: "/om-oss" }));
    expect(await redirects.updateRedirect(f.owner, foreign.id, { from: "/mine", to: "/om-oss" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await redirects.updateRedirect(f.owner, "00000000-0000-4000-8000-000000000000", { from: "/x", to: "/om-oss" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await redirects.updateRedirect(f.reader, foreign.id, { from: "/x", to: "/om-oss" })).toMatchObject({ ok: false, code: "forbidden" });
    await renameTerm(f.fx.storeId, f.category.id, f.category.slug);
  });
});

describe("deleting redirects", () => {
  it("deletes one or several of any kind, writes one entry with the count, and leaves another store's alone", async () => {
    const a = ok(await redirects.createRedirect(f.owner, { from: "/del-a", to: "/om-oss" }));
    const b = ok(await redirects.createRedirect(f.owner, { from: "/del-b", to: "/om-oss" }));
    const c = ok(await redirects.createRedirect(f.owner, { from: "/del-c", to: "/om-oss" }));
    const foreign = ok(await redirects.createRedirect(other.owner, { from: "/del-foreign", to: "/om-oss" }));
    const one = ok(await redirects.deleteRedirects(f.owner, [a.id]));
    expect(one.deleted).toBe(1);
    const entries = await auditActions(f.fx.storeId, "redirect.deleted");
    expect(entries.at(-1)?.details).toMatchObject({ count: 1, from: "/del-a", to: "/om-oss" });
    const many = ok(await redirects.deleteRedirects(f.owner, [b.id, c.id, foreign.id]));
    expect(many.deleted).toBe(2);
    expect((await auditActions(f.fx.storeId, "redirect.deleted")).at(-1)?.details).toEqual({ count: 2 });
    expect((await redirectRowsOf(other.fx.storeId)).some((r) => r.source === "/del-foreign")).toBe(true);
  });

  it("deletes an automatic redirect too", async () => {
    await renameTerm(f.fx.storeId, f.tag.id, `${f.tag.slug}-b`);
    const automatic = (await redirectRowsOf(f.fx.storeId)).find((r) => r.source === `/tag/${f.tag.slug}`)!;
    expect(ok(await redirects.deleteRedirects(f.owner, [String(automatic.id)])).deleted).toBe(1);
    await renameTerm(f.fx.storeId, f.tag.id, f.tag.slug);
  });

  it("refuses more than 200 at a time, none, and a member without the write key", async () => {
    const ids = Array.from({ length: REDIRECT_BULK_DELETE_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await redirects.deleteRedirects(f.owner, ids)).toMatchObject({ ok: false, code: "too_many" });
    expect(await redirects.deleteRedirects(f.owner, [])).toMatchObject({ ok: false, code: "nothing" });
    expect(await redirects.deleteRedirects(f.reader, ["00000000-0000-4000-8000-000000000001"])).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("listing and searching", () => {
  it("lists newest first, 50 to a page, by kind, and finds a substring of the source or the target in any case", async () => {
    const fx = await redirectFixture("redirects-list");
    for (let i = 0; i < 53; i += 1) ok(await redirects.createRedirect(fx.owner, { from: `/legacy/page-${String(i).padStart(2, "0")}`, to: i % 2 === 0 ? "/om-oss" : "/alle-produkter" }));
    await renameProduct(fx.fx.storeId, fx.product.id, `${fx.product.handle}-b`);
    const first = await redirects.listRedirects(fx.owner, {});
    expect(first).toMatchObject({ total: 54 + 0, page: 1, pages: 2, pageSize: 50, manual: 53 });
    expect(first.rows).toHaveLength(50);
    expect((await redirects.listRedirects(fx.owner, { page: 2 })).rows).toHaveLength(4);
    // A page past the end is the last page.
    expect((await redirects.listRedirects(fx.owner, { page: 99 })).page).toBe(2);
    const manual = await redirects.listRedirects(fx.owner, { filter: "manual" });
    expect(manual.total).toBe(53);
    expect(manual.rows.every((r) => r.kind === "manual")).toBe(true);
    const products = await redirects.listRedirects(fx.owner, { filter: "products" });
    expect(products.rows.map((r) => [r.kind, r.source, r.target])).toEqual([["product", `/p/${fx.product.handle}`, `/p/${fx.product.handle}-b`]]);
    expect((await redirects.listRedirects(fx.owner, { q: "PAGE-07" })).rows.map((r) => r.source)).toEqual(["/legacy/page-07"]);
    expect((await redirects.listRedirects(fx.owner, { q: "alle-prod", filter: "manual" })).total).toBe(26);
    // `%` and `_` in a search are the text's own.
    expect((await redirects.listRedirects(fx.owner, { q: "%" })).total).toBe(0);
    expect((await redirects.listRedirects(fx.owner, { q: "page_0" })).total).toBe(0);
  });

  it("gives each row its status: active, not used while the address is live, target not found, and the length of a chain", async () => {
    const fx = await redirectFixture("redirects-status");
    ok(await redirects.createRedirect(fx.owner, { from: "/s-active", to: "/om-oss" }));
    ok(await redirects.createRedirect(fx.owner, { from: "/s-missing", to: "/nowhere" }));
    // A manual redirect whose source later became live is not used.
    ok(await redirects.createRedirect(fx.owner, { from: "/s-live-later", to: "/om-oss" }));
    await db().execute(sql`update commerce.pages set slug = 's-live-later' where store_id = ${fx.fx.storeId}::uuid and slug = 'alle-produkter'`);
    // A chain that formed after the redirects were made (the middle one was added later).
    await db().execute(sql`
      insert into commerce.redirects (store_id, kind, source, target, origin) values
        (${fx.fx.storeId}::uuid, 'manual', '/c1', '/c2', 'editor'), (${fx.fx.storeId}::uuid, 'manual', '/c2', '/c3', 'editor')
    `);
    const status = new Map((await redirects.listRedirects(fx.owner, { filter: "manual" })).rows.map((r) => [r.source, r]));
    expect(status.get("/s-active")?.status).toBe("active");
    expect(status.get("/s-missing")?.status).toBe("target_missing");
    expect(status.get("/s-live-later")?.status).toBe("not_used");
    expect(status.get("/c1")).toMatchObject({ status: "chain", more: 1 });
  });

  it("shows a page's and an article's redirects, read only, with the current address", async () => {
    const fx = await redirectFixture("redirects-pages");
    await db().execute(sql`update commerce.pages set slug = 'om-oss-ny' where store_id = ${fx.fx.storeId}::uuid and slug = 'om-oss'`);
    const pages = await redirects.listRedirects(fx.owner, { filter: "pages" });
    expect(pages.rows.map((r) => [r.kind, r.source, r.target, r.readOnly])).toEqual([["page", "/om-oss", "/om-oss-ny", true]]);
    expect((await redirects.listRedirects(fx.owner, {})).rows.some((r) => r.kind === "page")).toBe(true);
  });

  it("shows nothing to a member without the read key, and only the store's own rows to another store", async () => {
    expect((await redirects.listRedirects(f.outsider, {})).rows).toEqual([]);
    expect(await redirects.redirectCounts(f.outsider)).toBeNull();
    const mine = await redirects.listRedirects(f.owner, { q: "del-foreign" });
    expect(mine.total).toBe(0);
    expect((await redirects.listRedirects(f.reader, {})).total).toBeGreaterThan(0);
  });

  it("counts the redirects of each kind from the rows", async () => {
    const fx = await redirectFixture("redirects-counts");
    ok(await redirects.createRedirect(fx.owner, { from: "/count-1", to: "/om-oss" }));
    await renameProduct(fx.fx.storeId, fx.product.id, `${fx.product.handle}-c`);
    await renameTerm(fx.fx.storeId, fx.category.id, `${fx.category.slug}-c`);
    const counts = (await redirects.redirectCounts(fx.owner))!;
    expect(counts).toMatchObject({ manual: 1, product: 1, category: 1, tag: 0, page: 0, article: 0, total: 3, limit: 100000 });
  });
});

describe("the batch door for importers", () => {
  it("adds many lines at once with the same checks, judged in order, and returns a plan per line", async () => {
    const fx = await makeStore("redirects-batch");
    const { ownerOf } = await import("./invoice-test-fixture");
    const owner = await ownerOf(fx);
    const result = await redirects.addRedirects(owner, [
      { from: "/b1", to: "/om-oss" },
      { from: "/b2", to: "/b1" },
      { from: "/cart", to: "/om-oss" },
      { from: "/b1", to: "/alle-produkter" },
    ]);
    expect(result).toMatchObject({ ok: true, written: 2 });
    const plans = (result as { plans: { action: string; target: string | null }[] }).plans;
    expect(plans.map((p) => p.action)).toEqual(["create", "create", "error", "error"]);
    // The chain through the earlier line is collapsed.
    expect(plans[1].target).toBe("/om-oss");
  });
});
