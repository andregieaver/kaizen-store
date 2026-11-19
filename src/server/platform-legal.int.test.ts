import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parsePageContent } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { PLATFORM_LEGAL_NB_LOCALE, PLATFORM_LEGAL_SLUGS } from "@/lib/platform-legal";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { writePlatformLegalPages, platformLegalOverview } = await import("./platform-legal");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`legal-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(account.id), email: String(account.email), name: "Admin", platformAdmin: true } as Account;
});

afterAll(async () => {
  await closeDb();
});

const published = async (slug: string) => {
  const [row] = await db().execute<Row>(sql`select id, published from commerce.pages where store_id is null and type = 'page' and slug = ${slug}`);
  return { id: String(row.id), content: parsePageContent(row.published)! };
};

describe("writePlatformLegalPages", () => {
  it("publishes the three pages in English with Norwegian texts, keeps written ones and writes again only when asked", async () => {
    const first = await writePlatformLegalPages(admin);
    expect(first.map((o) => o.kind)).toEqual(["terms", "privacy", "dpa"]);
    expect(first.every((o) => o.outcome === "made" || o.outcome === "written" || o.outcome === "kept")).toBe(true);
    expect(first.flatMap((o) => o.problems ?? [])).toEqual([]);

    const dpa = await published(PLATFORM_LEGAL_SLUGS.dpa);
    expect(dpa.content.title.length).toBeGreaterThan(0);
    const norwegian = localizePage(dpa.content, PLATFORM_LEGAL_NB_LOCALE);
    expect(norwegian.title).toBe("Databehandleravtale");

    const overview = await platformLegalOverview();
    expect(overview.pages.every((p) => p.published && p.written)).toBe(true);

    const again = await writePlatformLegalPages(admin);
    expect(again.map((o) => o.outcome)).toEqual(["kept", "kept", "kept"]);

    const over = await writePlatformLegalPages(admin, { overwrite: ["privacy"] });
    expect(over.map((o) => o.outcome)).toEqual(["kept", "written", "kept"]);
    const privacy = await published(PLATFORM_LEGAL_SLUGS.privacy);
    expect(localizePage(privacy.content, PLATFORM_LEGAL_NB_LOCALE).title).toBe("Personvernerklæring");

    const [log] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where action = 'platform.legal_pages_written' and account_id = ${admin.id}::uuid
    `);
    expect(Number(log.n)).toBe(3);
  });

  it("writes the house store's copies while kaizenaflow.com is served from it, leaving the platform's frozen, and names Kaizena Flow's data protection officer (D763)", async () => {
    const [house] = await db().execute<Row>(sql`select commerce.house_store() as id`);
    if (!house?.id) return;
    const houseId = String(house.id);
    const [setting] = await db().execute<Row>(sql`select site_from_store from commerce.platform_settings`);
    const [platform] = await db().execute<Row>(sql`select id from commerce.organisations where platform`);
    const before = (await published(PLATFORM_LEGAL_SLUGS.privacy)).content;
    await db().execute(sql`update commerce.platform_settings set site_from_store = true`);
    await db().execute(sql`insert into commerce.privacy_officers (organisation_id, name, email) values (${String(platform.id)}::uuid, 'Nordic Privacy AS', 'dpo@nordicprivacy.example')`);
    try {
      const out = await writePlatformLegalPages(admin, { overwrite: ["privacy"] });
      expect(out.every((o) => o.owner === houseId)).toBe(true);
      expect(out.flatMap((o) => o.problems ?? [])).toEqual([]);
      expect(out.find((o) => o.kind === "privacy")?.outcome).toMatch(/written|made/);
      const [copy] = await db().execute<Row>(sql`select published::text as text from commerce.pages where store_id = ${houseId}::uuid and type = 'page' and slug = ${PLATFORM_LEGAL_SLUGS.privacy}`);
      expect(String(copy.text)).toContain("Our data protection officer is Nordic Privacy AS, dpo@nordicprivacy.example.");
      expect(String(copy.text)).toContain("Personvernombudet vårt er Nordic Privacy AS, dpo@nordicprivacy.example.");
      // The platform's own copy is not on the site now and stays as it was.
      expect((await published(PLATFORM_LEGAL_SLUGS.privacy)).content).toEqual(before);
      expect((await platformLegalOverview()).pages.find((p) => p.kind === "privacy")?.written).toBe(true);
    } finally {
      await db().execute(sql`delete from commerce.privacy_officers where organisation_id = ${String(platform.id)}::uuid`);
      await db().execute(sql`update commerce.platform_settings set site_from_store = ${Boolean(setting.site_from_store)}`);
    }
  });
});
