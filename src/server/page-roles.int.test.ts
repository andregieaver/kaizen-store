import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, pageBlocks, type PageContent } from "@/lib/page-content";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const pages = await import("./pages");
const roles = await import("./page-roles");
const { getStore } = await import("./stores");
const rules = await import("./page-rules");

/**
 * A store's special pages (D112): its blog, search and 404 pages are
 * published pages of its own, chosen one each, with the standard page
 * shown until one is; and new stores get copies of the template's.
 */

const run = Date.now().toString(36);
const slug = `roles-${run}`;
let storeId: string;
let member: Membership;
const asMember = async (): Promise<Membership> => ({ ...member, store: (await getStore(slug))! });

const content = (name: string, overrides: Partial<PageContent> = {}): PageContent => ({
  ...newPageContent(),
  title: name,
  slug: `${name}-${run}`,
  rows: [{ id: "row-1", type: "row", layout: "1", columns: [{ id: "column-1", blocks: [{ id: "b1", type: "heading", text: name, level: 1 }] }] }] as PageContent["rows"],
  ...overrides,
});

const made = async (name: string, publish = true) => {
  const result = await pages.savePage(member.account, storeId, null, content(name), { publish });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'K', 'Roller') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Roller', null) as id`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "K", platformAdmin: false }, role: "owner", store: (await getStore(slug))! };
});

afterAll(async () => {
  await closeDb();
});

describe("choosing a page for a place", () => {
  it("takes a published page of the store's own, one place each", async () => {
    const draft = await made("draft-blog", false);
    const blog = await made("blog-page");
    const search = await made("search-page");
    const other = await db().execute<Row>(sql`select id from commerce.pages where store_id is null limit 1`);
    expect(await pages.setPageRole(member.account, storeId, "blog", draft)).toMatchObject({ ok: false, problems: [expect.stringContaining("Publish the page")] });
    expect(await pages.setPageRole(member.account, storeId, "blog", crypto.randomUUID())).toMatchObject({ ok: false });
    // Kaizen's own pages are not a store's to choose.
    if (other[0]) expect(await pages.setPageRole(member.account, storeId, "blog", String(other[0].id))).toMatchObject({ ok: false });

    expect(await pages.setPageRole(member.account, storeId, "blog", blog)).toEqual({ ok: true });
    expect((await getStore(slug))!.pageRoles).toEqual({ blog });
    // The same page cannot have another place, nor be the front or All products page.
    expect(await pages.setPageRole(member.account, storeId, "search", blog)).toMatchObject({ ok: false, problems: [expect.stringContaining("blog page")] });
    expect(await pages.setFrontPage(member.account, storeId, blog)).toMatchObject({ ok: false });
    expect(await pages.setProductsPage(member.account, storeId, blog)).toMatchObject({ ok: false });
    expect(await pages.setFrontPage(member.account, storeId, search)).toEqual({ ok: true });
    expect(await pages.setPageRole(member.account, storeId, "not_found", search)).toMatchObject({ ok: false, problems: [expect.stringContaining("front page")] });
    await pages.setFrontPage(member.account, storeId, null);

    // Another page replaces it; none gives the standard page back.
    expect(await pages.setPageRole(member.account, storeId, "blog", search)).toEqual({ ok: true });
    expect((await getStore(slug))!.pageRoles).toEqual({ blog: search });
    expect(await pages.setPageRole(member.account, storeId, "blog", null)).toEqual({ ok: true });
    expect((await getStore(slug))!.pageRoles).toEqual({});
  });

  it("shows the page while it is published, else the standard one, and lets go when it is deleted", async () => {
    const id = await made("nf-page");
    await pages.setPageRole(member.account, storeId, "not_found", id);
    let store = (await getStore(slug))!;
    expect((await pages.pageForRole(store, "not_found"))?.id).toBe(id);
    expect(await pages.pageForRole(store, "search")).toBeNull();
    await pages.unpublishPage(member.account, storeId, id);
    expect(await pages.pageForRole(store, "not_found")).toBeNull();
    await pages.deletePage(member.account, storeId, id);
    store = (await getStore(slug))!;
    expect(store.pageRoles).toEqual({});
  });

  it("refuses a place the database does not know", async () => {
    await expect(db().execute(sql`insert into commerce.page_roles (store_id, role, page_id) values (${storeId}::uuid, 'cart', ${crypto.randomUUID()}::uuid)`)).rejects.toThrow();
  });
});

describe("a starter page", () => {
  it("is made published and in place, in the store's language, and can be made again", async () => {
    for (const role of ["blog", "search", "not_found"] as const) {
      const result = await roles.createRolePage(await asMember(), role);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    const store = (await getStore(slug))!;
    expect(Object.keys(store.pageRoles).sort()).toEqual(["blog", "not_found", "search"]);
    const search = (await pages.pageForRole(store, "search"))!;
    expect(search.slug).toBe("search-page");
    expect(pageBlocks(search.content).some((b) => b.type === "search")).toBe(true);
    const nf = (await pages.pageForRole(store, "not_found"))!;
    expect(pageBlocks(nf.content).find((b) => b.type === "search")).toMatchObject({ results: false });
    // Again: a new page takes the role, at its own address.
    const again = await roles.createRolePage(await asMember(), "search");
    expect(again.ok).toBe(true);
    const next = (await pages.pageForRole((await getStore(slug))!, "search"))!;
    expect(next.id).not.toBe(search.id);
    expect(next.slug).toBe("search-page-2");
  });
});

describe("the search component", () => {
  const withSearch = (): PageContent => content("with-search", { rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "s", type: "search" }] }] }] as PageContent["rows"] });

  it("belongs in a store's pages and articles only", () => {
    expect(rules.pageRulesProblem(storeId, "page", withSearch())).toBeNull();
    expect(rules.pageRulesProblem(storeId, "article", withSearch())).toBeNull();
    expect(rules.pageRulesProblem(null, "page", withSearch())).toMatch(/store's pages/);
    expect(rules.pageRulesProblem(storeId, "header", withSearch())).toMatch(/pages and articles/);
    expect(rules.pageRulesProblem(storeId, "product_layout", withSearch())).toBeTruthy();
  });

  it("is refused when Kaizen's page is saved with it", async () => {
    const result = await pages.savePage(member.account, null, null, withSearch(), { publish: false });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("a new store", () => {
  it("gets copies of the template's blog, search and 404 pages", async () => {
    // This store stands in as the template: its published pages and their places are copied.
    const [owner] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`copy-${run}@example.com`}, 'C') returning id`);
    const [copy] = await db().execute<Row>(sql`select commerce.clone_store(${storeId}::uuid, ${`copy-${run}`}, 'Kopi', ${String(owner.id)}::uuid) as id`);
    const rows = await db().execute<Row>(sql`select r.role, p.slug, p.store_id from commerce.page_roles r join commerce.pages p on p.id = r.page_id where r.store_id = ${String(copy.id)}::uuid order by r.role`);
    expect(rows.map((r) => r.role)).toEqual(["blog", "not_found", "search"]);
    expect(rows.every((r) => String(r.store_id) === String(copy.id))).toBe(true);
    const store = (await getStore(`copy-${run}`))!;
    expect(Object.keys(store.pageRoles).sort()).toEqual(["blog", "not_found", "search"]);
  });
});
