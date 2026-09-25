import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent } from "@/lib/page-content";
import type { Term } from "@/lib/taxonomy";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const taxonomy = await import("./taxonomy");
const pages = await import("./pages");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const scope = { storeId: null, contentType: "page" } as const;
let admin: Account;

const ok = <T extends { ok: boolean }>(result: T) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};
const find = (terms: Term[], slug: string) => terms.find((t) => t.slug === slug);

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`terms-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true };
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.pages where slug like ${`%-${run}`}`);
  await db().execute(sql`delete from commerce.terms where store_id is null and slug like ${`%${run}%`}`);
  await closeDb();
});

describe("categories and tags (D50)", () => {
  it("makes addresses from names, one per kind, and refuses a chosen one that is taken", async () => {
    const first = ok(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Guides ${run}` }));
    expect(find(first.terms, `guides-${run}`)).toBeDefined();
    const second = ok(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Guides ${run}` }));
    expect(find(second.terms, `guides-${run}-2`)).toBeDefined();
    // Tags have their own addresses.
    ok(await taxonomy.createTerm(admin, scope, { kind: "tag", name: `Guides ${run}` }));
    expect(await taxonomy.createTerm(admin, scope, { kind: "category", name: "Other", slug: `guides-${run}` })).toEqual({
      ok: false,
      problems: [`Another category already has the address guides-${run}. Choose another.`],
    });
  });

  it("nests categories, refuses circles, and moves subcategories up when one is deleted", async () => {
    const top = ok(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Top ${run}` }));
    const middle = ok(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Middle ${run}`, parentId: top.id }));
    const bottom = ok(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Bottom ${run}`, parentId: middle.id }));
    expect(await taxonomy.updateTerm(admin, scope, top.id, { name: `Top ${run}`, slug: `top-${run}`, parentId: bottom.id })).toEqual({
      ok: false,
      problems: ["A category cannot be inside itself or one of its own subcategories."],
    });
    const deleted = ok(await taxonomy.deleteTerm(admin, scope, middle.id));
    expect(find(deleted.terms, `bottom-${run}`)?.parentId).toBe(top.id);
    const [log] = await db().execute<Row>(sql`
      select action from commerce.audit_log where account_id = ${admin.id}::uuid order by id desc limit 1
    `);
    expect(log.action).toBe("page.category_deleted");
  });

  it("keeps on a page only Kaizen's own page categories and tags", async () => {
    const category = ok(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Help ${run}` }));
    const tag = ok(await taxonomy.createTerm(admin, scope, { kind: "tag", name: `New ${run}` }));
    const unknown = "00000000-0000-4000-8000-000000000000";
    const saved = await pages.savePage(
      admin,
      null,
      null,
      {
        ...newPageContent(),
        title: "Tagged",
        slug: `tagged-${run}`,
        // A tag given as a category, and an id that is nothing, are left out.
        categories: [category.id, tag.id, unknown],
        tags: [tag.id, tag.id],
      },
      { publish: false },
    );
    const page = await pages.getPageForEdit(null, ok(saved).id);
    expect(page?.draft.categories).toEqual([category.id]);
    expect(page?.draft.tags).toEqual([tag.id]);
  });
});
