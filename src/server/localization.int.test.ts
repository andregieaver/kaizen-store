import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
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
 * Languages and currencies are chosen apart (D109): any languages whatever the
 * countries, any currencies whatever the languages, and the address says
 * which a shopper sees.
 */

const run = Date.now().toString(36);
let storeId: string;
let slug: string;
let member: Membership;

const ecb = `<Cube><Cube time='2026-09-29'><Cube currency='NOK' rate='11.7'/><Cube currency='SEK' rate='11.0'/><Cube currency='DKK' rate='7.46'/><Cube currency='USD' rate='1.16'/></Cube></Cube>`;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`loc-${run}@example.com`}, 'Kari', 'Lokal') returning id
  `);
  slug = `loc-${run}`;
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Lokal', null) as id`);
  storeId = String(store.id);
  // The template's countries, languages and currencies, as before D178 step 4 (a new store starts in its own country alone).
  await db().execute(sql`update commerce.stores set features = features || array['countries', 'languages', 'currencies'] where id = ${storeId}::uuid`);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`loc-${run}@example.com`}`);
  member = {
    account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false },
    role: "owner",
    store: (await getStore(slug))!,
  };
});

/** The signed-in owner as a page would get them: the store as it is now. */
const asMember = async (): Promise<Membership> => ({ ...member, store: (await getStore(slug))! });

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

describe("store languages", () => {
  it("are chosen whatever the countries, one variant each, and keep a country's own", async () => {
    expect(await localization.saveLanguages(await asMember(), [], {})).toMatchObject({ ok: false });
    expect(await localization.saveLanguages(await asMember(), ["en-GB", "en-IE", "nb-NO"], {})).toMatchObject({ ok: false });
    // Norway shows Norwegian by default, so the store cannot drop it.
    expect(await localization.saveLanguages(await asMember(), ["en-GB", "de-DE"], {})).toMatchObject({ ok: false });
    expect(await localization.saveLanguages(await asMember(), ["xx-XX", "nb-NO"], {})).toMatchObject({ ok: false });

    expect(await localization.saveLanguages(await asMember(), ["en-GB", "nb-NO", "sv-SE", "da-DK", "de-DE"], {})).toEqual({ ok: true });
    const store = (await getStore(slug))!;
    expect(store.localization.locales).toEqual(["en-GB", "nb-NO", "sv-SE", "da-DK", "de-DE"]);
  });

  it("change what a country shows by default, and the address follows", async () => {
    expect(await localization.saveLanguages(await asMember(), ["en-GB", "nb-NO", "sv-SE", "da-DK"], { NO: "en-GB" })).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select default_locale, locales from commerce.markets where store_id = ${storeId}::uuid and code = 'NO'`);
    expect(row.default_locale).toBe("en-GB");
    expect(row.locales).toContain("en-GB");
    // Norwegian is still offered: its address now names it.
    const store = (await getStore(slug))!;
    const norwegian = (await resolveShop(slug, "no-nb"))!;
    expect(store.markets.find((m) => m.code === "NO")?.locale).toBe("en-GB");
    expect(norwegian.market.locale).toBe("nb-NO");
    expect(norwegian.market.slug).toBe("no-nb");
    await localization.saveLanguages(await asMember(), ["nb-NO", "en-GB", "sv-SE", "da-DK"], { NO: "nb-NO" });
  });
});

describe("store currencies", () => {
  it("are chosen whatever the languages, and each needs a rate", async () => {
    expect(await localization.saveCurrencies(await asMember(), [{ currency: "EUR", rate: 1, roundTo: 1 }, { currency: "USD", rate: null, roundTo: 1 }], false)).toMatchObject({ ok: false });
    expect(await localization.saveCurrencies(await asMember(), [
      { currency: "EUR", rate: 1, roundTo: 5 },
      { currency: "NOK", rate: 11.6, roundTo: 1 },
      { currency: "SEK", rate: 11, roundTo: 100 },
    ], false)).toEqual({ ok: true });
    const store = (await getStore(slug))!;
    expect(store.localization.currencies.map((c) => c.currency).sort()).toEqual(["DKK", "EUR", "NOK", "SEK"]);

    // Norway can be shown in euro and krona, in either language; euro is not Norwegian's alone.
    const euro = (await resolveShop(slug, "no-eur"))!;
    expect(euro.market.currency).toBe("EUR");
    expect(euro.market.locale).toBe("nb-NO");
    const english = (await resolveShop(slug, "no-en-eur"))!;
    expect(english.market.locale).toBe("en-GB");
    expect(english.market.conversion.step).toBe(5);
    expect(english.market.conversion.factor).toBeCloseTo(1 / 11.6 / 1, 5);
    // A currency the store does not offer, or a language it does not, is not found.
    expect(await resolveShop(slug, "no-usd")).toBeNull();
    expect(await resolveShop(slug, "no-fr")).toBeNull();
  });

  it("keep each country's own currency, even when left out", async () => {
    expect(await localization.saveCurrencies(await asMember(), [{ currency: "EUR", rate: 1, roundTo: 1 }], false)).toEqual({ ok: true });
    const store = (await getStore(slug))!;
    expect(store.localization.currencies.map((c) => c.currency)).toContain("NOK");
  });

  it("follow the ECB's rates when asked", async () => {
    vi.stubGlobal("fetch", async () => new Response(ecb, { status: 200 }));
    expect(await localization.saveCurrencies(await asMember(), [{ currency: "EUR", rate: 1, roundTo: 1 }, { currency: "USD", rate: null, roundTo: 1 }], true)).toEqual({ ok: true });
    let store = (await getStore(slug))!;
    expect(store.ratesAuto).toBe(true);
    expect(store.localization.currencies.find((c) => c.currency === "SEK")?.rate).toBe(11);
    expect(store.localization.currencies.find((c) => c.currency === "NOK")?.rate).toBe(11.7);

    // The daily refresh moves them.
    vi.stubGlobal("fetch", async () => new Response(ecb.replace("11.7", "11.9"), { status: 200 }));
    expect((await localization.refreshAutoRates()).map((s) => s.slug)).toContain(slug);
    store = (await getStore(slug))!;
    expect(store.localization.currencies.find((c) => c.currency === "NOK")?.rate).toBe(11.9);

    // If the ECB cannot be read, nothing changes.
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    expect(await localization.fetchRatesNow(member)).toMatchObject({ ok: false });
    expect(await localization.saveCurrencies(await asMember(), [{ currency: "EUR", rate: 1, roundTo: 1 }], true)).toMatchObject({ ok: false });
  });
});
