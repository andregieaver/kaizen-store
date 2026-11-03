import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const display = await import("./price-display");
const fx = await import("./invoice-test-fixture");
const { auditRows } = await import("./trust-fixtures");
const { getStore } = await import("./stores");

/**
 * How a store shows prices and quantities (D429, D430), against a real database: what a new store has, a save by the settings page (the
 * store's choices, a country's own decimals, the words by language, tidied and kept only for the store's languages), refusals that save
 * nothing, the audit entry that never holds the words, and the store's markets carrying the style shoppers' amounts are written with.
 */

let a: Awaited<ReturnType<typeof fx.makeStore>>;

beforeAll(async () => {
  a = await fx.makeStore("prisvisning");
});

afterAll(async () => {
  await closeDb();
});

describe("the price display", () => {
  it("starts with decimals always, no words and − and + on product pages", async () => {
    const shown = await display.readPriceDisplay(a.storeId);
    expect(shown).toMatchObject({ decimals: "always", words: {}, quantityPicker: "buttons" });
    expect(shown.markets.length).toBeGreaterThan(0);
    expect(shown.markets.every((m) => m.decimals === null)).toBe(true);
  });

  it("saves the store's choices, a country's own decimals and the words, which the store's markets then carry", async () => {
    const owner = await fx.ownerOf(a);
    const before = await display.readPriceDisplay(a.storeId);
    const home = before.markets[0].code;
    const saved = await display.savePriceDisplay(
      owner,
      {
        decimals: "hide_whole",
        quantityPicker: "box",
        markets: before.markets.map((m) => ({ code: m.code, decimals: m.code === home ? "always" : null })),
        words: { "nb-NO": { prefix: "  Fra   kun ", suffix: "/stk" }, "xx-XX": { prefix: "Gone", suffix: "" } },
      },
      ["nb-NO", "en-GB"],
    );
    expect(saved).toEqual({ ok: true });
    const after = await display.readPriceDisplay(a.storeId);
    expect(after).toMatchObject({ decimals: "hide_whole", quantityPicker: "box", words: { "nb-NO": { prefix: "Fra kun", suffix: "/stk" } } });
    expect(after.markets.find((m) => m.code === home)?.decimals).toBe("always");

    const [audit] = await auditRows(a.storeId, "store.price_display");
    expect(audit.details).toMatchObject({ decimals: "hide_whole", quantityPicker: "box", languagesWithWords: ["nb-NO"] });
    expect(JSON.stringify(audit.details)).not.toContain("Fra kun");

    const store = await getStore(a.slug);
    expect(store?.priceDecimals).toBe("hide_whole");
    expect(store?.quantityPicker).toBe("box");
    const market = store?.keptMarkets.find((m) => m.code === home);
    expect(market?.priceStyle?.decimals).toBe("always");
    expect(market?.priceStyle?.words?.byLocale["nb-NO"]).toEqual({ prefix: "Fra kun", suffix: "/stk" });
  });

  it("refuses a claim, a long word and a country not the store's, saving nothing", async () => {
    const owner = await fx.ownerOf(a);
    const before = await display.readPriceDisplay(a.storeId);
    const refused = await display.savePriceDisplay(
      owner,
      {
        ...before,
        decimals: "always",
        markets: [...before.markets, { code: "ZZ", decimals: "always" }],
        words: { "nb-NO": { prefix: "Beste pris", suffix: "x".repeat(30) } },
      },
      ["nb-NO"],
    );
    expect(refused).toMatchObject({
      ok: false,
      problems: expect.arrayContaining([
        { kind: "market", code: "ZZ" },
        { kind: "word", locale: "nb-NO", place: "prefix", problem: expect.objectContaining({ kind: "claim", claim: "bestPrice" }) },
        { kind: "word", locale: "nb-NO", place: "suffix", problem: { kind: "long", max: 24 } },
      ]),
    });
    expect(await display.readPriceDisplay(a.storeId)).toEqual(before);
    const [row] = await db().execute(sql`select price_decimals from commerce.stores where id = ${a.storeId}::uuid`);
    expect(row.price_decimals).toBe("hide_whole");
  });
});
