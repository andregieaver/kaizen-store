import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type PageContent } from "@/lib/page-content";
import { PLATFORM_ROLE_COPY } from "@/lib/platform-roles";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const pages = await import("./pages");
const roles = await import("./platform-roles");
const seo = await import("./seo");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;
const slugs: string[] = [];

const content = (slug: string): PageContent => ({
  ...newPageContent(),
  title: `Page ${slug}`,
  slug,
  rows: [
    {
      id: "row-1",
      type: "row",
      layout: "1",
      columns: [{ id: "column-1", blocks: [{ id: "block-1", type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `About ${slug}.` }] }] } }] }],
    },
  ] as PageContent["rows"],
});

/** One of Kaizen's pages, published or a draft. */
async function make(name: string, publish: boolean): Promise<string> {
  const slug = `${name}-${run}`;
  slugs.push(slug);
  const result = await pages.savePage(admin, null, null, content(slug), { publish, type: "page" });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
}

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`roles-${run}@example.com`}, 'Admin', true) returning id, email
  `);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true };
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.platform_page_roles`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_page_roles`);
  await db().execute(sql`delete from commerce.pages where store_id is null and (slug like ${`%-${run}`} or slug like 'front-page%' or slug like 'blog-archive%' or slug like 'page-not-found%')`);
  await closeDb();
});

describe("Kaizen's front page, blog and 404 page (D143)", () => {
  it("shows the standard page until a published page is chosen, then that page, and the standard again when cleared", async () => {
    expect(await roles.platformPageForRole("front")).toBeNull();
    const about = await make("about", true);
    expect(await roles.setPlatformPageRole(admin, "front", about)).toEqual({ ok: true });
    const front = await roles.platformPageForRole("front");
    expect(front?.id).toBe(about);
    expect(await roles.platformRoleOf(about)).toBe("front");
    expect(await roles.platformPageForRole("blog")).toBeNull();
    expect(await roles.setPlatformPageRole(admin, "front", null)).toEqual({ ok: true });
    expect(await roles.platformPageForRole("front")).toBeNull();
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where action = 'platform.page_role_changed' and account_id = ${admin.id}::uuid`);
    expect(Number(audited.n)).toBe(2);
  });

  it("refuses a draft, a page that is gone, a page that has another place, and a store's page", async () => {
    const draft = await make("draft", false);
    expect((await roles.setPlatformPageRole(admin, "blog", draft))).toMatchObject({ ok: false, problems: [expect.stringContaining("Publish the page")] });
    expect(await roles.setPlatformPageRole(admin, "blog", crypto.randomUUID())).toMatchObject({ ok: false });
    const page = await make("both", true);
    expect(await roles.setPlatformPageRole(admin, "front", page)).toEqual({ ok: true });
    expect(await roles.setPlatformPageRole(admin, "blog", page)).toMatchObject({ ok: false, problems: [expect.stringContaining("front page")] });
    // The same place again is fine; a store's page is not Kaizen's to place.
    expect(await roles.setPlatformPageRole(admin, "front", page)).toEqual({ ok: true });
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where is_template limit 1`);
    const [theirs] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${String(store.id)}::uuid and type = 'page' and published_at is not null limit 1`);
    if (theirs) expect(await roles.setPlatformPageRole(admin, "not_found", String(theirs.id))).toMatchObject({ ok: false });
  });

  it("moves a place to another page, one place per page, and lets a deleted page's place go", async () => {
    const one = await make("one", true);
    const two = await make("two", true);
    await roles.setPlatformPageRole(admin, "blog", one);
    await roles.setPlatformPageRole(admin, "blog", two);
    expect(await roles.platformRoleOf(one)).toBeNull();
    expect(await roles.platformRoleOf(two)).toBe("blog");
    await db().execute(sql`delete from commerce.pages where id = ${two}::uuid`);
    expect(await roles.platformPageForRole("blog")).toBeNull();
  });

  it("falls back to the standard page while the chosen one is unpublished", async () => {
    const page = await make("later", true);
    await roles.setPlatformPageRole(admin, "not_found", page);
    expect((await roles.platformPageForRole("not_found"))?.id).toBe(page);
    await pages.unpublishPage(admin, null, page, "page");
    expect(await roles.platformPageForRole("not_found")).toBeNull();
  });

  it("makes a starter page for each place, published and in place, at the place's own address", async () => {
    for (const role of ["front", "blog", "not_found"] as const) {
      const made = await roles.createPlatformRolePage(admin, role);
      if (!made.ok) throw new Error(made.problems.join(" "));
      const chosen = await roles.platformPageForRole(role);
      expect(chosen?.id).toBe(made.id);
      expect(chosen?.slug.startsWith(PLATFORM_ROLE_COPY[role].slug)).toBe(true);
    }
    const front = await roles.platformPageForRole("front");
    expect(JSON.stringify(front?.content.rows)).toContain('"type":"plans"');
    // Made again, the address is taken by the first: the new page gets the next free one.
    await db().execute(sql`delete from commerce.platform_page_roles where role = 'front'`);
    const again = await roles.createPlatformRolePage(admin, "front");
    expect(again.ok).toBe(true);
    expect((await roles.platformPageForRole("front"))?.slug).toBe("front-page-2");
  });

  it("leaves a page with a place of its own out of the sitemap, where the place's address is", async () => {
    const about = await make("placed", true);
    const plain = await make("plain", true);
    await roles.setPlatformPageRole(admin, "blog", about);
    const sitemap = await seo.platformSitemap();
    expect(sitemap).not.toContain(`/placed-${run}<`);
    expect(sitemap).toContain(`/plain-${run}<`);
    expect(sitemap).toContain("/blog<");
    expect(plain).toBeTruthy();
  });
});
