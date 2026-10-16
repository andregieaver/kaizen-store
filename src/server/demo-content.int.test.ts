import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { NO_DEMO } from "@/lib/demo-content";

import type { Account, Membership } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const platform = await import("./platform");
const demo = await import("./demo-content");
const { getStore } = await import("./stores");

/**
 * A new store's demo content (`docs/theme-showcase-phase-1.md` step 4b), against the seeded template: marked when the store is made, by
 * an approval and by *Create a store*; removed in one press, archiving products and deleting pages, articles, categories and tags the owner
 * left as they were, and their menu links; what the owner changed, and what their own things still use, stays and is named.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const rows = async (query: ReturnType<typeof sql>) => db().execute<Row>(query);
const one = async (query: ReturnType<typeof sql>) => (await rows(query))[0];

let admin: Account;
let owner: Account;
let storeId: string;
const slug = `demo-content-${run}`;

async function approve(email: string, storeSlug: string): Promise<string> {
  const [request] = await rows(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${storeSlug}) returning id`);
  const approved = await platform.approveAccessRequest(admin, String(request.id), storeSlug, storeSlug, "https://example.com");
  if (!approved.ok) throw new Error(approved.problems.join(" "));
  return approved.storeId;
}

const product = (handle: string) => one(sql`select id, status from commerce.products where store_id = ${storeId}::uuid and handle = ${handle}`);
const page = (pageSlug: string) => one(sql`select id from commerce.pages where store_id = ${storeId}::uuid and slug = ${pageSlug}`);
const term = (termSlug: string) => one(sql`select id, parent_id from commerce.terms where store_id = ${storeId}::uuid and slug = ${termSlug}`);
const menuLinks = async (name: string) => {
  const menu = await one(sql`select items from commerce.menus where store_id = ${storeId}::uuid and name = ${name}`);
  return (menu.items as { depth: number; link: Record<string, string> }[]).map((i) => `${i.link.kind}:${i.link.handle ?? i.link.slug ?? i.link.url ?? ""}@${i.depth}`);
};

beforeAll(async () => {
  const [row] = await rows(sql`insert into commerce.accounts (email, name, platform_admin) values (${`demo-admin-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true } as Account;
  storeId = await approve(`demo-owner-${run}@example.com`, slug);
  const account = await one(sql`select id, email from commerce.accounts where lower(email) = lower(${`demo-owner-${run}@example.com`})`);
  owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false } as Account;
});

afterAll(async () => {
  await closeDb();
});

describe("marking a new store's demo content", () => {
  it("marks every product, page, article, category and tag the template brought, but not the store's working pages", async () => {
    const marks = await rows(sql`select kind, count(*)::int as n from commerce.store_demo_items where store_id = ${storeId}::uuid group by kind`);
    const [counts] = await rows(sql`
      select (select count(*)::int from commerce.products where store_id = ${storeId}::uuid and status <> 'archived') as products,
             (select count(*)::int from commerce.terms where store_id = ${storeId}::uuid) as terms
    `);
    expect(Object.fromEntries(marks.map((m) => [m.kind, m.n]))).toMatchObject({ product: counts.products, term: counts.terms });
    // The All products page is the store's working page; the front page, the about page and the article are demo.
    const pages = await rows(sql`
      select p.slug from commerce.store_demo_items d join commerce.pages p on p.id = d.ref_id where d.store_id = ${storeId}::uuid and d.kind = 'page' order by p.slug
    `);
    const productsPage = await one(sql`select p.slug from commerce.stores s join commerce.pages p on p.id = s.products_page_id where s.id = ${storeId}::uuid`);
    expect(pages.map((p) => p.slug)).not.toContain(productsPage.slug);
    expect(pages.length).toBeGreaterThan(0);

    const content = await demo.demoContent(storeId, "nb-NO");
    expect(content?.changed).toEqual([]);
    expect(content?.counts.products).toBe(counts.products);
    // Marking again marks nothing new.
    expect(await demo.markDemoContent(storeId)).toBe(0);
  });

  it("marks a store an owner creates too", async () => {
    const made = await platform.createStoreForOwner(owner, "Second", `demo-second-${run}`);
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect(Number((await one(sql`select count(*)::int as n from commerce.store_demo_items where store_id = ${made.storeId}::uuid`)).n)).toBeGreaterThan(0);
  });

  it("counts a marked product with a trade's own handle as demo in the setup wizard, and its button archives it", async () => {
    const made = await platform.createStoreForOwner(owner, "Third", `demo-third-${run}`);
    if (!made.ok) throw new Error(made.problems.join(" "));
    // A content pack's products have their own handles (not `demo-…`); the store's copy is marked all the same.
    await rows(sql`update commerce.products set handle = 'linen-shirt' where store_id = ${made.storeId}::uuid and handle = 'demo-notatbok'`);
    const { archiveDemoProducts, getSetupProgress } = await import("./setup");
    const store = (await getStore(`demo-third-${run}`))!;
    const before = await getSetupProgress(store);
    expect(before.counts.ownProducts).toBe(0);
    await archiveDemoProducts({ account: owner, store } as Membership);
    expect(await one(sql`select status from commerce.products where store_id = ${made.storeId}::uuid and handle = 'linen-shirt'`)).toMatchObject({ status: "archived" });
    expect((await getSetupProgress(store)).counts.demoProducts).toBe(0);
  });
});

describe("removing the demo content", () => {
  beforeAll(async () => {
    // The owner edits one product in the editor (it keeps its categories and tag), and changes the about page and a subcategory.
    const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
    const store = (await getStore(slug))!;
    const editor = await getEditorContext(store);
    const notebook = await product("demo-notatbok");
    const input = (await getProductForEdit(store, editor, String(notebook.id)))!;
    const saved = await saveProduct(store, editor, String(notebook.id), input, undefined, undefined, owner);
    expect(saved.ok).toBe(true);
    await rows(sql`update commerce.pages set updated_at = clock_timestamp() where store_id = ${storeId}::uuid and slug = 'om-oss'`);
    await rows(sql`update commerce.terms set updated_at = clock_timestamp() where store_id = ${storeId}::uuid and slug = 'belysning'`);
    // A link of their own under a demo product in the main menu.
    await rows(sql`
      update commerce.menus set items = (
        select jsonb_agg(e order by n) from (
          select item as e, n * 2 as n from jsonb_array_elements(items) with ordinality as t(item, n)
          union all
          select ${JSON.stringify({ label: { "nb-NO": "Mine" }, link: { kind: "url", url: "/mine" }, depth: 1 })}::jsonb, n * 2 + 1
          from jsonb_array_elements(items) with ordinality as t(item, n) where item -> 'link' ->> 'handle' = 'demo-keramikkopp'
        ) x
      ) where store_id = ${storeId}::uuid and name = 'Main menu'
    `);
    expect(await menuLinks("Main menu")).toContain("url:/mine@1");
  });

  it("shows the owner what is still demo and what they changed", async () => {
    const content = (await demo.demoContent(storeId, "nb-NO"))!;
    expect(content.changed.map((i) => i.noun).sort()).toEqual(["category", "page", "product"]);
    expect(content.changed).toContainEqual(expect.objectContaining({ noun: "product", title: "Demo: Notatbok A5" }));
    expect(content.items.some((i) => i.title === "Demo: Notatbok A5")).toBe(false);
    expect(content.items).toContainEqual(expect.objectContaining({ noun: "page", title: "Forside" }));
  });

  it("archives and deletes only what is still as it was, takes its menu links out, and names what stayed", async () => {
    const front = await one(sql`select front_page_id from commerce.stores where id = ${storeId}::uuid`);
    expect(front.front_page_id).not.toBeNull();
    const result = await demo.removeDemoContent(owner.id, storeId, "nb-NO");

    // Products: archived, never deleted; the one the owner saved stays on sale.
    expect(result.removed.products).toBeGreaterThan(0);
    expect(await product("demo-keramikkopp")).toMatchObject({ status: "archived" });
    expect(await product("demo-notatbok")).toMatchObject({ status: "active" });
    // Pages: the front page and the article are deleted (the store shows its standard front page); the about page stays.
    expect(await page("forside")).toBeUndefined();
    expect(await page("nye-produkter")).toBeUndefined();
    expect(await page("om-oss")).toBeDefined();
    expect((await one(sql`select front_page_id from commerce.stores where id = ${storeId}::uuid`)).front_page_id).toBeNull();
    // Terms: the notebook's category and tag stay (it is still on sale); "hjem" and the article category go; the changed subcategory
    // stays and moves up to where its parent was.
    expect(await term("papir")).toBeDefined();
    expect(await term("nyhet")).toBeDefined();
    expect(await term("hjem")).toBeUndefined();
    expect(await term("nyheter")).toBeUndefined();
    expect(await term("belysning")).toMatchObject({ parent_id: null });

    expect(result.kept).toEqual([
      { kind: "product", title: "Demo: Notatbok A5", reason: "changed" },
      { kind: "page", title: "Om oss", reason: "changed" },
      { kind: "term", title: "Belysning", reason: "changed" },
      { kind: "term", title: "Nyhet", reason: "in_use" },
      { kind: "term", title: "Papir", reason: "in_use" },
    ]);

    // Menus: links to what went are out, the owner's link moved up in its place, the rest as it was.
    const main = await menuLinks("Main menu");
    expect(main).toContain("product:demo-notatbok@0");
    expect(main).toContain("url:/mine@0");
    expect(main.filter((l) => l.startsWith("product:demo-keramikkopp") || l.startsWith("product:demo-bordlampe"))).toEqual([]);
    const footer = await menuLinks("Footer menu");
    expect(footer).toContain("page:om-oss@0");
    expect(footer).toContain("blog:@0");
    expect(footer.filter((l) => l.startsWith("category:hjem") || l.startsWith("product:demo-handlenett"))).toEqual([]);

    // Nothing is marked any more: what stayed is the owner's, and the card is gone.
    expect(await demo.demoContent(storeId, "nb-NO")).toBeNull();
    const logged = await one(sql`select details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.demo_removed'`);
    expect(logged.details).toMatchObject({ products: result.removed.products, kept: result.kept.length });
  });

  it("does nothing the second time", async () => {
    expect(await demo.removeDemoContent(owner.id, storeId, "nb-NO")).toEqual({ removed: NO_DEMO, kept: [] });
    expect(Number((await one(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.demo_removed'`)).n)).toBe(1);
  });
});
