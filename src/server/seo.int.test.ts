import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseStoreSeo } from "@/lib/seo";

import type { Membership } from "./auth";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));

const seo = await import("./seo");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const slug = `seo-${run}`;
let member: Membership;

const settings = (overrides: Record<string, unknown> = {}) => ({
  title: { "nb-NO": "Kopper fra Oslo" },
  description: { "nb-NO": "Håndlagde kopper." },
  image: null,
  sameAs: ["https://instagram.com/kopp"],
  hidden: false,
  aiAssistants: true,
  aiTraining: false,
  robots: "Disallow: /no/p/gammel",
  llms: "Vi dreier alt selv.",
  verification: { google: "abc", bing: "" },
  ...overrides,
});

beforeAll(async () => {
  // A store copied from the demo, as sign-up makes one, then opened.
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`seo-${run}@example.com`}, 'Kari', 'Kopp') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Kopp', null)`);
  await db().execute(sql`update commerce.stores set setup_completed_at = now(), country = 'NO' where slug = ${slug}`);
  const [account] = await db().execute<Row>(sql`
    select id, email from commerce.accounts where lower(email) = ${`seo-${run}@example.com`}
  `);
  const store = await getStore(slug);
  member = {
    account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false },
    store: store!,
    role: "owner",
  };
});

afterAll(async () => {
  await closeDb();
});

describe("a store's search settings", () => {
  it("saves valid settings and keeps no empty languages", async () => {
    const result = await seo.saveStoreSeo(member, settings({ description: { "nb-NO": "Håndlagde kopper.", "sv-SE": "" } }));
    expect(result).toEqual({ ok: true });
    const store = await getStore(slug);
    expect(store?.seo).toMatchObject({ title: { "nb-NO": "Kopper fra Oslo" }, description: { "nb-NO": "Håndlagde kopper." }, aiTraining: false });
    expect(store?.seo.description).not.toHaveProperty("sv-SE");
  });

  it("refuses crawler rules it cannot read, saying which line", async () => {
    const result = await seo.saveStoreSeo(member, settings({ robots: "Noindex: /x" }));
    expect(result).toEqual({
      ok: false,
      problems: ['Crawler rules: Line 1: "Noindex" is not supported here. Use User-agent, Allow or Disallow.'],
    });
  });

  it("puts the store's rules in the site's robots.txt under its address", async () => {
    const robots = await seo.siteRobots();
    expect(robots).toContain(`Disallow: /s/${slug}/no/p/gammel`);
    expect(robots).toMatch(new RegExp(`User-agent: GPTBot\\n[^]*?Disallow: /s/${slug}/\\n`));
    expect(robots).toContain("Disallow: /admin");
  });

  it("lists the open store's products in its sitemap and llms.txt, with the owner's words", async () => {
    const sitemap = await seo.storeSitemap(slug);
    expect(sitemap).toContain(`/s/${slug}/no/p/`);
    const llms = await seo.storeLlms(slug);
    expect(llms).toMatch(/^# Kopp\n\n> Håndlagde kopper\.\n\nVi dreier alt selv\.\n/);
    expect(llms).toContain("## Products (Norge, NOK)");
    expect((await seo.sitemapIndex())).toContain(`/s/${slug}/sitemap.xml`);
  });

  it("leaves a hidden store out of sitemaps and llms.txt", async () => {
    await seo.saveStoreSeo(member, settings({ hidden: true }));
    expect(await seo.storeSitemap(slug)).toBeNull();
    expect(await seo.storeLlms(slug)).toBeNull();
    expect(await seo.sitemapIndex()).not.toContain(`/s/${slug}/`);
    expect(await seo.platformLlms()).not.toContain(`/s/${slug}/`);
  });
});

describe("Kaizen's own search settings", () => {
  it("saves them, with sitemap lines allowed in its crawler rules", async () => {
    const before = await seo.getPlatformSeo();
    const result = await seo.savePlatformSeo(
      member.account,
      settings({ title: { en: "Kaizen" }, robots: "Sitemap: https://example.com/extra.xml" }),
    );
    expect(result).toEqual({ ok: true });
    expect(await seo.siteRobots()).toContain("Sitemap: https://example.com/extra.xml");
    // Leave the shared settings as they were.
    await db().execute(sql`update commerce.platform_settings set seo = ${JSON.stringify(before)}::jsonb`);
    expect(parseStoreSeo((await db().execute<Row>(sql`select seo from commerce.platform_settings`))[0].seo).robots).toBe(before.robots);
  });
});
