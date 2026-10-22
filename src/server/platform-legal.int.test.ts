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
});
