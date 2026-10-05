import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { areaOfAction } from "@/lib/audit";
import { NOT_PERSONAL } from "@/lib/personal-data";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createTestDatabase } from "./testing";

/**
 * Redirects and the 404 report (wave 2, second run, D168, `docs/wave-2-redirects.md` 3): the rules the database itself holds, run against real Postgres
 * (PGlite) with every migration applied. A changed address leaves an automatic redirect that points at the thing; an address taken replaces it; a redirect row is
 * kept honest (shape, store, kind, immutability of the automatic ones, no loop); the 404 report has one writer with a cap; the new tables are private,
 * store-owned and left behind by a copy, and a copy keeps a category's search texts.
 */

let db: PGlite;
let shop: string;
let other: string;
let owner: string;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('rd-shop', 'Redirects', 'NO') returning id")).id;
  other = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('rd-other', 'Other', 'NO') returning id")).id;
  owner = (await one<{ id: string }>("insert into commerce.accounts (email) values ('rd-owner@example.com') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const all = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string | number }>(sql, params)).n);

let counter = 0;

/** A product of a store: a draft with its title, picture and active variant, ready to be made active. */
async function product(storeId: string, handle: string, status: "draft" | "active" | "archived" = "draft"): Promise<string> {
  counter += 1;
  const maker = (
    await one<{ id: string }>(
      `insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
       values ($1, 'Maker', 'Street 1, 10115 Berlin', 'safety@maker.example', 'DE') returning id`,
      [storeId],
    )
  ).id;
  const id = (
    await one<{ id: string }>(
      `insert into commerce.products (store_id, handle, manufacturer_id, tax_code) values ($1, $2, $3, 'txcd_99999999') returning id`,
      [storeId, handle, maker],
    )
  ).id;
  await db.query("insert into commerce.product_translations (store_id, product_id, locale, title) values ($1, $2, 'nb-NO', 'Produkt')", [storeId, id]);
  await db.query("insert into commerce.product_media (store_id, product_id, url) values ($1, $2, 'https://example.com/a.jpg')", [storeId, id]);
  await db.query("insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, $3)", [storeId, id, `RD-${counter}`]);
  if (status !== "draft") await db.query("update commerce.products set status = 'active' where id = $1", [id]);
  if (status === "archived") await db.query("update commerce.products set status = 'archived' where id = $1", [id]);
  return id;
}
const rename = (id: string, handle: string) => db.query("update commerce.products set handle = $2 where id = $1", [id, handle]);
const setStatus = (id: string, status: string) => db.query("update commerce.products set status = $2 where id = $1", [id, status]);

async function term(storeId: string | null, kind: "category" | "tag", slug: string, type = "product"): Promise<string> {
  return (
    await one<{ id: string }>("insert into commerce.terms (store_id, content_type, kind, name, slug) values ($1, $2, $3, $4, $5) returning id", [storeId, type, kind, slug, slug])
  ).id;
}

type Row = { kind: string; source: string; target: string | null; product_id: string | null; term_id: string | null; origin: string };
const rows = (storeId = shop) =>
  all<Row>("select kind, source, target, product_id, term_id, origin from commerce.redirects where store_id = $1 order by source", [storeId]);
const sourcesOf = async (storeId = shop) => (await rows(storeId)).map((r) => r.source);
const manual = (source: string, target: string, storeId = shop, origin = "editor") =>
  db.query("insert into commerce.redirects (store_id, kind, source, target, origin, created_by) values ($1, 'manual', $2, $3, $4, $5)", [storeId, source, target, origin, owner]);

describe("the new tables are private, store-owned and left with the original", () => {
  const TABLES = ["redirects", "not_found_hits", "not_found_ignored"];

  it("have row-level security on and no policy, so the Data API reaches none of them", async () => {
    const found = await all<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'commerce' and c.relname = any($1) order by 1`,
      [TABLES],
    );
    expect(found).toEqual(TABLES.slice().sort().map((relname) => ({ relname, relrowsecurity: true })));
    expect(await all("select 1 from pg_policies where schemaname = 'commerce' and tablename = any($1)", [TABLES])).toEqual([]);
  });

  it("have a store_id, are `never` in COPY_RULES, and are not personal data", async () => {
    for (const table of TABLES) {
      expect(COPY_RULES[table]?.group, table).toBe("never");
      expect(NOT_PERSONAL[table], table).toMatch(/\S/);
      expect(await count("select count(*) as n from information_schema.columns where table_schema = 'commerce' and table_name = $1 and column_name = 'store_id'", [table]), table).toBe(1);
    }
    expect(COPY_RULES.terms.group).toBe("settings");
  });

  it("have the activity log areas of the redirects in the database as in code", async () => {
    for (const action of ["redirect.created", "redirect.updated", "redirect.deleted", "redirects.import_started", "redirects.import_applied", "not_found.ignored", "not_found.restored", "term.fields_updated", "return.refunded"]) {
      expect([action, (await one<{ a: string }>("select commerce.audit_area_of($1) as a", [action])).a]).toEqual([action, areaOfAction(action)]);
    }
    expect(areaOfAction("redirect.created")).toBe("website");
  });

  it("have every foreign key indexed (the performance advisor asks)", async () => {
    const unindexed = await all<{ conname: string }>(
      `select c.conname from pg_constraint c
        where c.contype = 'f' and c.conrelid = any(array['commerce.redirects'::regclass, 'commerce.not_found_hits'::regclass, 'commerce.not_found_ignored'::regclass])
          and not exists (
            select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)`,
    );
    expect(unindexed).toEqual([]);
  });
});

describe("when a product first became active", () => {
  it("is set when it first becomes active and never cleared or moved", async () => {
    const id = await product(shop, "fa-1");
    expect((await one<{ f: string | null }>("select first_active_at as f from commerce.products where id = $1", [id])).f).toBeNull();
    await setStatus(id, "active");
    const first = (await one<{ f: Date }>("select first_active_at as f from commerce.products where id = $1", [id])).f;
    expect(first).toBeInstanceOf(Date);
    await setStatus(id, "archived");
    await setStatus(id, "draft");
    await setStatus(id, "active");
    await db.query("update commerce.products set first_active_at = null where id = $1", [id]);
    await db.query("update commerce.products set first_active_at = now() + interval '1 day' where id = $1", [id]);
    expect((await one<{ f: Date }>("select first_active_at as f from commerce.products where id = $1", [id])).f).toEqual(first);
  });

  it("stays null for a product that is a draft or an archived one made before this column (no backfill)", async () => {
    const id = await product(shop, "fa-2");
    await rename(id, "fa-2-moved");
    expect((await one<{ f: string | null }>("select first_active_at as f from commerce.products where id = $1", [id])).f).toBeNull();
  });
});

describe("a changed handle leaves an automatic redirect that points at the product", () => {
  it("for an active product, and for an archived one", async () => {
    const active = await product(shop, "cup-old", "active");
    await rename(active, "cup-new");
    expect(await rows()).toContainEqual({ kind: "product", source: "/p/cup-old", target: null, product_id: active, term_id: null, origin: "system" });
    const archived = await product(shop, "mug-old", "archived");
    await rename(archived, "mug-new");
    expect(await sourcesOf()).toContain("/p/mug-old");
  });

  it("not for a product that was never live, nor when the handle did not change", async () => {
    const draft = await product(shop, "draft-old");
    await rename(draft, "draft-new");
    expect(await sourcesOf()).not.toContain("/p/draft-old");
    const active = await product(shop, "same-handle", "active");
    await rename(active, "same-handle");
    await db.query("update commerce.products set tax_code = 'txcd_1' where id = $1", [active]);
    expect(await sourcesOf()).not.toContain("/p/same-handle");
  });

  it("for a product that was live once and is a draft again", async () => {
    const id = await product(shop, "once-live", "active");
    await setStatus(id, "draft");
    await rename(id, "once-live-2");
    expect(await sourcesOf()).toContain("/p/once-live");
  });

  it("every old address of a product renamed three times, each to the product (never a chain)", async () => {
    const id = await product(shop, "tri-a", "active");
    await rename(id, "tri-b");
    await rename(id, "tri-c");
    await rename(id, "tri-d");
    const found = (await rows()).filter((r) => r.source.startsWith("/p/tri-"));
    expect(found.map((r) => [r.source, r.product_id, r.target])).toEqual([
      ["/p/tri-a", id, null],
      ["/p/tri-b", id, null],
      ["/p/tri-c", id, null],
    ]);
  });

  it("is deleted when the product takes the address again, and by a product that takes it", async () => {
    const id = await product(shop, "back-a", "active");
    await rename(id, "back-b");
    expect(await sourcesOf()).toContain("/p/back-a");
    await rename(id, "back-a");
    expect(await sourcesOf()).not.toContain("/p/back-a");
    expect(await sourcesOf()).toContain("/p/back-b");
    // Another product taking an old address replaces its redirect.
    await product(shop, "back-b");
    expect(await sourcesOf()).not.toContain("/p/back-b");
  });

  it("moves an older automatic row for the same address to the newest owner", async () => {
    const first = await product(shop, "move-a", "active");
    await rename(first, "move-b");
    // The address is free of products now (`move-a` redirects to `first`); a second product takes it, which deletes the redirect, and leaves it again.
    const second = await product(shop, "move-a", "active");
    expect(await sourcesOf()).not.toContain("/p/move-a");
    await rename(second, "move-c");
    expect((await rows()).find((r) => r.source === "/p/move-a")).toMatchObject({ product_id: second });
  });

  it("ends consistent when two products swap handles through a third", async () => {
    const a = await product(shop, "swap-x", "active");
    const b = await product(shop, "swap-y", "active");
    await rename(a, "swap-tmp");
    await rename(b, "swap-x");
    await rename(a, "swap-y");
    const found = (await rows()).filter((r) => r.source.startsWith("/p/swap-"));
    // x and y are live again (no redirect from them); the temporary handle redirects to the product that had it.
    expect(found.map((r) => [r.source, r.product_id])).toEqual([["/p/swap-tmp", a]]);
  });

  it("leaves a manual redirect from the address alone, in either direction", async () => {
    // A manual redirect made while the address was free (the product archived), then the product takes the address.
    await manual("/p/man-old", "/category/x");
    await product(shop, "man-old", "active");
    expect((await rows()).find((r) => r.source === "/p/man-old")).toMatchObject({ kind: "manual", target: "/category/x" });
    // The product renames away: the address is held by the manual redirect, which stays, and no automatic one replaces it.
    const id = (await one<{ id: string }>("select id from commerce.products where store_id = $1 and handle = 'man-old'", [shop])).id;
    await rename(id, "man-new");
    expect((await rows()).filter((r) => r.source === "/p/man-old")).toEqual([expect.objectContaining({ kind: "manual", target: "/category/x" })]);
  });

  it("is deleted with the product, and a store's redirects never reach another store", async () => {
    const id = await product(other, "cascade-a", "active");
    await rename(id, "cascade-b");
    expect(await sourcesOf(other)).toEqual(["/p/cascade-a"]);
    expect(await sourcesOf()).not.toContain("/p/cascade-a");
    await db.query("delete from commerce.products where id = $1", [id]);
    expect(await sourcesOf(other)).toEqual([]);
  });
});

describe("a changed slug of a category or a tag leaves a redirect that points at the term", () => {
  it("for each kind, at its own address, and never for a name change", async () => {
    const category = await term(shop, "category", "cat-old");
    const tag = await term(shop, "tag", "tag-old");
    await db.query("update commerce.terms set slug = 'cat-new' where id = $1", [category]);
    await db.query("update commerce.terms set slug = 'tag-new' where id = $1", [tag]);
    await db.query("update commerce.terms set name = 'Something else' where id = $1", [category]);
    const found = (await rows()).filter((r) => r.source.includes("-old"));
    expect(found.filter((r) => r.source.startsWith("/c") || r.source.startsWith("/tag"))).toEqual([
      { kind: "category", source: "/category/cat-old", target: null, product_id: null, term_id: category, origin: "system" },
      { kind: "tag", source: "/tag/tag-old", target: null, product_id: null, term_id: tag, origin: "system" },
    ]);
  });

  it("a category and a tag with the same slug are different addresses", async () => {
    const category = await term(shop, "category", "same-a");
    const tag = await term(shop, "tag", "same-a");
    await db.query("update commerce.terms set slug = 'same-b' where id = $1", [category]);
    expect(await sourcesOf()).toContain("/category/same-a");
    expect(await sourcesOf()).not.toContain("/tag/same-a");
    await db.query("update commerce.terms set slug = 'same-c' where id = $1", [tag]);
    expect(await sourcesOf()).toContain("/tag/same-a");
  });

  it("every old slug of a term renamed twice goes to the term, and a term taking the slug again removes its redirect", async () => {
    const id = await term(shop, "category", "twice-a");
    await db.query("update commerce.terms set slug = 'twice-b' where id = $1", [id]);
    await db.query("update commerce.terms set slug = 'twice-c' where id = $1", [id]);
    expect((await rows()).filter((r) => r.source.startsWith("/category/twice-")).map((r) => [r.source, r.term_id])).toEqual([
      ["/category/twice-a", id],
      ["/category/twice-b", id],
    ]);
    await db.query("update commerce.terms set slug = 'twice-a' where id = $1", [id]);
    expect(await sourcesOf()).not.toContain("/category/twice-a");
    // Another term taking an old slug replaces its redirect.
    await term(shop, "category", "twice-b");
    expect(await sourcesOf()).not.toContain("/category/twice-b");
  });

  it("not for the terms of pages and articles, nor Kaizen's own (they have no such pages)", async () => {
    const page = await term(shop, "category", "pg-old", "page");
    await db.query("update commerce.terms set slug = 'pg-new' where id = $1", [page]);
    const article = await term(null, "category", "ar-old", "article");
    await db.query("update commerce.terms set slug = 'ar-new' where id = $1", [article]);
    expect((await sourcesOf()).filter((s) => s.includes("pg-") || s.includes("ar-"))).toEqual([]);
    expect(await count("select count(*) as n from commerce.redirects where store_id is null")).toBe(0);
  });

  it("is deleted with the term", async () => {
    const id = await term(other, "tag", "gone-a");
    await db.query("update commerce.terms set slug = 'gone-b' where id = $1", [id]);
    expect(await sourcesOf(other)).toContain("/tag/gone-a");
    await db.query("delete from commerce.terms where id = $1", [id]);
    expect(await sourcesOf(other)).not.toContain("/tag/gone-a");
  });
});

describe("a redirect row", () => {
  it("is unique per store and source, and the same address may redirect in another store", async () => {
    await manual("/uniq", "/p/a");
    await expect(manual("/uniq", "/p/b")).rejects.toThrow(/redirects_store_source_key/);
    await expect(manual("/uniq", "/p/b", other)).resolves.toBeDefined();
  });

  it("has the columns of its kind: a manual one has a target and no entity, an automatic one an entity and no target", async () => {
    const p = await product(shop, "shape-p", "active");
    const t = await term(shop, "category", "shape-t");
    const insert = (cols: string, vals: string, params: unknown[]) => db.query(`insert into commerce.redirects (store_id, ${cols}) values ($1, ${vals})`, [shop, ...params]);
    await rejects("insert into commerce.redirects (store_id, kind, source, origin) values ($1, 'manual', '/s1', 'editor')", [shop], /redirects_kind_columns/);
    await expect(insert("kind, source, target, origin, product_id", "'manual', '/s2', '/x', 'editor', $2", [p])).rejects.toThrow(/redirects_kind_columns/);
    await expect(insert("kind, source, origin, product_id, target", "'product', '/p/s3', 'system', $2, '/x'", [p])).rejects.toThrow(/redirects_kind_columns/);
    await expect(insert("kind, source, origin", "'product', '/p/s4', 'system'", [])).rejects.toThrow(/redirects_kind_columns/);
    await expect(insert("kind, source, origin, term_id", "'category', '/category/s5', 'system', $2", [t])).resolves.toBeDefined();
    await expect(insert("kind, source, origin, product_id, term_id", "'category', '/category/s6', 'system', $2, $3", [p, t])).rejects.toThrow(/redirects_kind_columns/);
    await expect(insert("kind, source, origin", "'wishlist', '/s7', 'system'", [])).rejects.toThrow(/redirects_kind/);
  });

  it("is made by the system if automatic and by a person or a job if manual", async () => {
    const p = await product(shop, "origin-p", "active");
    await rejects("insert into commerce.redirects (store_id, kind, source, target, origin) values ($1, 'manual', '/o1', '/x', 'system')", [shop], /redirects_origin_kind/);
    await rejects("insert into commerce.redirects (store_id, kind, source, product_id, origin) values ($1, 'product', '/p/o2', $2, 'editor')", [shop, p], /redirects_origin_kind/);
    await rejects("insert into commerce.redirects (store_id, kind, source, target, origin) values ($1, 'manual', '/o3', '/x', 'robot')", [shop], /redirects_origin/);
    for (const origin of ["editor", "import", "report", "assistant"]) await expect(manual(`/o-${origin}`, "/x", shop, origin)).resolves.toBeDefined();
  });

  it("keeps a source in the normal form: a leading slash, no query, fragment, trailing slash, `//`, capital, space, backslash or control character", async () => {
    for (const source of ["no-slash", "/", "/a?b", "/a#b", "/a/", "/a//b", "/A", "/a b", "/a\\b", "/a\u0001b", "/a\tb", `/${"a".repeat(500)}`]) {
      await expect(manual(source, "/x"), JSON.stringify(source)).rejects.toThrow(/redirects_source_shape/);
    }
    for (const source of ["/a", "/a/b.html", "/årets-tilbud", "/a%2fb", `/${"a".repeat(499)}`]) await expect(manual(`/shape${source}`.slice(0, 500), "/x"), source).resolves.toBeDefined();
  });

  it("keeps a target a path on the store: a leading slash, not `//`, no space or backslash, at most 2,000 characters; a query keeps its case", async () => {
    for (const target of ["x", "//evil.example", "https://evil.example", "/a b", "/a\\b", "/a\u0001b", `/${"a".repeat(2000)}`]) {
      await expect(manual(`/t-${Math.abs(hash(target))}`, target), JSON.stringify(target)).rejects.toThrow(/redirects_target_shape/);
    }
    for (const target of ["/", "/a", "/A?Q=Z#Top", "/search?q=a%20b", `/${"a".repeat(1999)}`]) await expect(manual(`/tok-${Math.abs(hash(target))}`, target), target).resolves.toBeDefined();
  });

  it("has a non-negative hit count", async () => {
    await manual("/hits-a", "/x");
    await rejects("update commerce.redirects set hits = -1 where store_id = $1 and source = '/hits-a'", [shop], /redirects_hits/);
  });

  it("belongs to a product or term of its own store and of its own kind", async () => {
    const foreignProduct = await product(other, "foreign-p", "active");
    const foreignTerm = await term(other, "category", "foreign-c");
    const own = await term(shop, "category", "own-c");
    const pageTerm = await term(shop, "category", "own-page", "page");
    const ins = (kind: string, source: string, col: string, id: string) =>
      db.query(`insert into commerce.redirects (store_id, kind, source, ${col}, origin) values ($1, $2, $3, $4, 'system')`, [shop, kind, source, id]);
    await expect(ins("product", "/p/fp", "product_id", foreignProduct)).rejects.toThrow(/redirects_product_fk/);
    await expect(ins("category", "/category/fc", "term_id", foreignTerm)).rejects.toThrow(/redirect.entity/);
    await expect(ins("category", "/category/pg", "term_id", pageTerm)).rejects.toThrow(/redirect.entity/);
    await expect(ins("tag", "/tag/own", "term_id", own)).rejects.toThrow(/redirect.entity/);
    await expect(ins("category", "/category/own", "term_id", own)).resolves.toBeDefined();
  });

  it("has the address of its kind: /p/ for a product, /category/ for a category, /tag/ for a tag", async () => {
    const p = await product(shop, "kindaddr-p", "active");
    const c = await term(shop, "category", "kindaddr-c");
    const tg = await term(shop, "tag", "kindaddr-t");
    const ins = (kind: string, source: string, col: string, id: string) =>
      db.query(`insert into commerce.redirects (store_id, kind, source, ${col}, origin) values ($1, $2, $3, $4, 'system')`, [shop, kind, source, id]);
    await expect(ins("product", "/category/x", "product_id", p)).rejects.toThrow(/redirect.source/);
    await expect(ins("category", "/tag/x", "term_id", c)).rejects.toThrow(/redirect.source/);
    await expect(ins("tag", "/p/x", "term_id", tg)).rejects.toThrow(/redirect.source/);
  });
});

describe("an automatic redirect is the triggers'", () => {
  let id: string;
  beforeAll(async () => {
    const p = await product(shop, "auto-a", "active");
    await rename(p, "auto-b");
    id = (await one<{ id: string }>("select id from commerce.redirects where store_id = $1 and source = '/p/auto-a'", [shop])).id;
  });
  const update = (set: string, params: unknown[] = []) => db.query(`update commerce.redirects set ${set} where id = $1`, [id, ...params]);

  it("changes only its counters", async () => {
    await update("hits = hits + 5, last_hit_at = now()");
    expect(Number((await one<{ hits: string }>("select hits from commerce.redirects where id = $1", [id])).hits)).toBe(5);
    await expect(update("source = '/p/other'")).rejects.toThrow(/redirect.automatic/);
    await expect(update("target = '/x'")).rejects.toThrow(/redirect.automatic|redirects_kind_columns/);
    await expect(update("origin = 'editor'")).rejects.toThrow(/redirect.automatic|redirects_origin_kind/);
    await expect(update("product_id = null")).rejects.toThrow(/redirect.automatic|redirects_kind_columns/);
    await expect(update("kind = 'manual'")).rejects.toThrow(/redirect.fixed/);
    await expect(update("store_id = $2", [other])).rejects.toThrow(/redirect.fixed/);
  });

  it("may be deleted by staff", async () => {
    await db.query("delete from commerce.redirects where id = $1", [id]);
    expect(await count("select count(*) as n from commerce.redirects where id = $1", [id])).toBe(0);
  });
});

describe("a manual redirect", () => {
  it("may be edited: its source, its target and its origin, and its edit is dated; counters are not edits", async () => {
    await manual("/edit-a", "/p/a");
    const read = () => one<{ source: string; target: string; origin: string; updated_at: Date; created_at: Date }>(
      "select source, target, origin, updated_at, created_at from commerce.redirects where store_id = $1 and source like '/edit-%'", [shop]);
    const before = await read();
    await db.query("update commerce.redirects set hits = hits + 1 where store_id = $1 and source = '/edit-a'", [shop]);
    expect((await read()).updated_at).toEqual(before.updated_at);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.query("update commerce.redirects set target = '/p/b', origin = 'import' where store_id = $1 and source = '/edit-a'", [shop]);
    const after = await read();
    expect(after).toMatchObject({ source: "/edit-a", target: "/p/b", origin: "import" });
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    await db.query("update commerce.redirects set source = '/edit-b' where store_id = $1 and source = '/edit-a'", [shop]);
    expect((await read()).source).toBe("/edit-b");
  });

  it("keeps its store, its kind and its maker", async () => {
    await manual("/fixed-a", "/p/a");
    const up = (set: string, params: unknown[] = []) => db.query(`update commerce.redirects set ${set} where store_id = $1 and source = '/fixed-a'`, [shop, ...params]);
    await expect(up("store_id = $2", [other])).rejects.toThrow(/redirect.fixed/);
    await expect(up("kind = 'product'")).rejects.toThrow(/redirect.fixed/);
    await expect(up("created_by = null")).rejects.toThrow(/redirect.fixed/);
    await expect(up("created_at = now() - interval '1 day'")).rejects.toThrow(/redirect.fixed/);
  });
});

describe("no manual redirect closes a loop", () => {
  const loopMessage = /redirect.loop/;

  it("refuses a redirect to itself, with or without a query", async () => {
    await expect(manual("/self-a", "/self-a")).rejects.toThrow(loopMessage);
    await expect(manual("/self-b", "/self-b?x=1#y")).rejects.toThrow(loopMessage);
    await expect(manual("/self-c", "/SELF-C/")).rejects.toThrow(loopMessage);
  });

  it("refuses A to B when B goes to A, and a longer cycle", async () => {
    await manual("/loop-b", "/loop-a");
    await expect(manual("/loop-a", "/loop-b")).rejects.toThrow(loopMessage);
    await manual("/cyc-b", "/cyc-c");
    await manual("/cyc-c", "/cyc-d?x=1");
    await expect(manual("/cyc-d", "/cyc-b")).rejects.toThrow(loopMessage);
    await expect(manual("/cyc-d", "/CYC-B/")).rejects.toThrow(loopMessage);
    // A chain that leads away is not a loop.
    await expect(manual("/cyc-d", "/p/somewhere")).resolves.toBeDefined();
  });

  it("refuses an edit that closes a loop, and allows replacing a target", async () => {
    await manual("/edit-loop-a", "/p/a");
    await manual("/edit-loop-b", "/edit-loop-a");
    await expect(db.query("update commerce.redirects set target = '/edit-loop-b' where store_id = $1 and source = '/edit-loop-a'", [shop])).rejects.toThrow(loopMessage);
    await expect(db.query("update commerce.redirects set target = '/p/c' where store_id = $1 and source = '/edit-loop-a'", [shop])).resolves.toBeDefined();
    // Editing a source into a loop is refused as well: `/p/c` is where `/edit-loop-a` goes now, and `/edit-loop-b` goes to `/edit-loop-a`.
    await expect(db.query("update commerce.redirects set source = '/p/c' where store_id = $1 and source = '/edit-loop-b'", [shop])).rejects.toThrow(loopMessage);
    await expect(db.query("update commerce.redirects set source = '/p/d' where store_id = $1 and source = '/edit-loop-b'", [shop])).resolves.toBeDefined();
  });

  it("finds a cycle of 20 hops, and only manual redirects of the same store count", async () => {
    for (let i = 0; i < 20; i += 1) await manual(`/long-${i}`, `/long-${i + 1}`);
    await expect(manual("/long-20", "/long-0")).rejects.toThrow(loopMessage);
    // Another store's redirect from the target is not a hop.
    await manual("/foreign-b", "/foreign-a", other);
    await expect(manual("/foreign-a", "/foreign-b")).resolves.toBeDefined();
  });

  it("does not take an automatic redirect for a hop (its source is never a live address and it points at a live one)", async () => {
    const p = await product(shop, "auto-hop-a", "active");
    await rename(p, "auto-hop-b");
    await expect(manual("/auto-hop-start", "/p/auto-hop-a")).resolves.toBeDefined();
    await expect(manual("/p/auto-hop-b", "/auto-hop-start")).resolves.toBeDefined();
  });
});

describe("the 404 report has one writer", () => {
  const record = (path: string, crawler = false, cap = 1000, storeId = shop) => db.query("select commerce.record_not_found($1, $2, $3, $4)", [storeId, path, crawler, cap]);
  const today = "(now() at time zone 'utc')::date";
  const hit = (path: string | null, storeId = shop) =>
    one<{ hits: number; crawler_hits: number } | undefined>(
      `select hits, crawler_hits from commerce.not_found_hits where store_id = $1 and day = ${today} and path is not distinct from $2`,
      [storeId, path],
    );

  it("counts a request for an address, and the robots among them", async () => {
    await record("/collections/count");
    await record("/collections/count");
    await record("/collections/count");
    await record("/collections/count", true);
    await record("/collections/count", true);
    expect(await hit("/collections/count")).toEqual({ hits: 5, crawler_hits: 2 });
    expect(await count("select count(*) as n from commerce.not_found_hits where store_id = $1 and path = '/collections/count'", [shop])).toBe(1);
  });

  it("keeps each store's counts apart", async () => {
    await record("/apart", false, 1000, shop);
    await record("/apart", true, 1000, other);
    expect(await hit("/apart", shop)).toEqual({ hits: 1, crawler_hits: 0 });
    expect(await hit("/apart", other)).toEqual({ hits: 1, crawler_hits: 1 });
  });

  it("counts by the UTC day: a row of an earlier day is another row", async () => {
    await db.query("insert into commerce.not_found_hits (store_id, day, path, hits) values ($1, (now() at time zone 'utc')::date - 1, '/yesterday', 7)", [shop]);
    await record("/yesterday");
    expect(await hit("/yesterday")).toEqual({ hits: 1, crawler_hits: 0 });
    expect(await count("select count(*) as n from commerce.not_found_hits where store_id = $1 and path = '/yesterday'", [shop])).toBe(2);
  });

  it("stops adding addresses at the cap and counts the rest in the day's one row with no address; known addresses keep counting", async () => {
    for (const path of ["/cap-a", "/cap-b", "/cap-c"]) await record(path, false, 3, other);
    // The store already has `/apart` today, so `/cap-a` and `/cap-b` are the 2nd and 3rd addresses and the cap of three is reached at `/cap-c`.
    await record("/cap-d", false, 3, other);
    await record("/cap-d", true, 3, other);
    await record("/cap-e", false, 3, other);
    expect(await hit("/cap-c", other)).toBeUndefined();
    expect(await hit("/cap-d", other)).toBeUndefined();
    expect(await hit("/cap-e", other)).toBeUndefined();
    expect(await hit(null, other)).toEqual({ hits: 4, crawler_hits: 1 });
    await record("/cap-a", false, 3, other);
    expect(await hit("/cap-a", other)).toEqual({ hits: 2, crawler_hits: 0 });
    expect(await count("select count(*) as n from commerce.not_found_hits where store_id = $1 and path is null", [other])).toBe(1);
    // Another store is not held by it (the cap is the caller's: the service passes 1,000).
    await record("/cap-d", false, 1000, shop);
    expect(await hit("/cap-d", shop)).toEqual({ hits: 1, crawler_hits: 0 });
  });

  it("refuses no address, and a path that is not an address (the table's checks)", async () => {
    await rejects("select commerce.record_not_found($1, null, false, 10)", [shop], /not_found\.path/);
    await rejects("select commerce.record_not_found($1, 'no-slash', false, 10)", [shop], /not_found_hits_path/);
    await rejects("select commerce.record_not_found($1, $2, false, 10)", [shop, `/${"a".repeat(200)}`], /not_found_hits_path/);
  });

  it("holds its counts: robots are never more than the requests, and the null row is the one of its day", async () => {
    await rejects("update commerce.not_found_hits set crawler_hits = hits + 1 where store_id = $1 and path = '/apart'", [shop], /not_found_hits_counts/);
    await db.query("insert into commerce.not_found_hits (store_id, day, path, hits) values ($1, '2020-01-01', null, 1)", [shop]);
    await rejects("insert into commerce.not_found_hits (store_id, day, path, hits) values ($1, '2020-01-01', null, 1)", [shop], /not_found_hits_key/);
  });

  it("has addresses staff hid, once each and in the shape of an address", async () => {
    await db.query("insert into commerce.not_found_ignored (store_id, path, created_by) values ($1, '/hidden', $2)", [shop, owner]);
    await rejects("insert into commerce.not_found_ignored (store_id, path) values ($1, '/hidden')", [shop], /not_found_ignored_store_id_path_pk/);
    await rejects("insert into commerce.not_found_ignored (store_id, path) values ($1, 'hidden')", [shop], /not_found_ignored_path/);
    await expect(db.query("insert into commerce.not_found_ignored (store_id, path) values ($1, '/hidden')", [other])).resolves.toBeDefined();
  });

  it("is deleted with its store, as the other tables of a store are", async () => {
    const found = await all<{ conrelid: string; confdeltype: string }>(
      `select conrelid::regclass::text as conrelid, confdeltype from pg_constraint
        where contype = 'f' and confrelid = 'commerce.stores'::regclass and conrelid = any(array['commerce.redirects'::regclass, 'commerce.not_found_hits'::regclass, 'commerce.not_found_ignored'::regclass])
        order by 1`,
    );
    expect(found).toEqual([
      { conrelid: "commerce.not_found_hits", confdeltype: "c" },
      { conrelid: "commerce.not_found_ignored", confdeltype: "c" },
      { conrelid: "commerce.redirects", confdeltype: "c" },
    ]);
  });
});

describe("a category's search texts", () => {
  const SEO = { "nb-NO": { title: "Lamper til hjemmet", description: "Alle lampene." }, "sv-SE": { title: "Lampor", description: "" } };

  it("are an object, empty by default, and per term", async () => {
    const id = await term(shop, "category", "seo-a");
    expect((await one<{ seo: unknown }>("select seo from commerce.terms where id = $1", [id])).seo).toEqual({});
    await db.query("update commerce.terms set seo = $2::jsonb where id = $1", [id, JSON.stringify(SEO)]);
    expect((await one<{ seo: unknown }>("select seo from commerce.terms where id = $1", [id])).seo).toEqual(SEO);
    for (const bad of ["[]", "\"x\"", "5", "null"]) await expect(db.query("update commerce.terms set seo = $2::jsonb where id = $1", [id, bad]), bad).rejects.toThrow(/terms_seo_object|not-null/);
  });

  it("are copied with the term by clone_store() and duplicate_store(), and no redirect or report goes with them", async () => {
    const source = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('rd-source', 'Source', 'NO') returning id")).id;
    const category = await term(source, "category", "seo-copy");
    const tag = await term(source, "tag", "seo-copy-tag");
    await db.query("update commerce.terms set seo = $2::jsonb where id = $1", [category, JSON.stringify(SEO)]);
    await db.query("update commerce.terms set slug = 'seo-copy-2' where id = $1", [tag]);
    await db.query("update commerce.terms set slug = 'seo-copy-3' where id = $1", [tag]);
    await manual("/source-manual", "/p/x", source);
    await db.query("select commerce.record_not_found($1, '/source-miss', false, 10)", [source]);
    for (const [fn, slug] of [["clone_store", "rd-clone"], ["duplicate_store", "rd-dup"]] as const) {
      const copy = (await one<{ id: string }>(`select commerce.${fn}($1, $2, 'Copy', $3) as id`, [source, slug, owner])).id;
      const copied = await all<{ slug: string; seo: unknown }>("select slug, seo from commerce.terms where store_id = $1 and content_type = 'product' order by slug", [copy]);
      expect([fn, copied.find((t) => t.slug === "seo-copy")?.seo]).toEqual([fn, SEO]);
      expect([fn, copied.find((t) => t.slug === "seo-copy-3")?.seo]).toEqual([fn, {}]);
      // Redirects and the report are history of the original's addresses: the copy starts with none, not even the ones its own renames could make.
      for (const table of ["redirects", "not_found_hits", "not_found_ignored"]) expect([fn, table, await count(`select count(*) as n from commerce.${table} where store_id = $1`, [copy])]).toEqual([fn, table, 0]);
    }
  });
});

/** A small deterministic hash, so a table of bad values has a distinct source each. */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}
