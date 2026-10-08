import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { oneLanguageChoice } from "@/lib/localization";
import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const localization = await import("./localization");
const { getStore } = await import("./stores");
const { resolveShop } = await import("./shop");

/**
 * One language needs no "several" (D178): with Several languages off, an owner still chooses the store's main language and what its country
 * shows, as the Languages and currencies page does while the feature is off. The other languages it keeps texts in stay, hidden.
 */

const run = Date.now().toString(36);
let slug: string;
let member: Membership;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`one-${run}@example.com`}, 'Kari', 'Ett språk') returning id
  `);
  slug = `one-${run}`;
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Ett språk', null)`);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`one-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, role: "owner", store: (await getStore(slug))! };
});

afterAll(async () => {
  await closeDb();
});

describe("the store's one language", () => {
  it("is English at the country's own address, Norwegian kept but hidden", async () => {
    const store = (await getStore(slug))!;
    expect(store.features).not.toContain("languages");
    const kept = store.localization.keptLocales;
    expect(kept).toContain("nb-NO");

    const [locales, markets] = oneLanguageChoice(kept, "en-GB", { NO: "en-GB" });
    expect(await localization.saveLanguages({ ...member, store }, locales, markets)).toEqual({ ok: true });

    const after = (await getStore(slug))!;
    expect(after.localization.locales).toEqual(["en-GB"]);
    expect(after.localization.keptLocales).toContain("nb-NO");
    expect(after.markets.find((m) => m.code === "NO")?.ownLocale).toBe("en-GB");
    expect((await resolveShop(slug, "no"))!.market.locale).toBe("en-GB");
    // Norwegian is not offered while Several languages is off.
    expect(await resolveShop(slug, "no-nb")).toBeNull();
  });
});
