import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isPriceDecimals, type PriceDecimals } from "@/lib/money";
import { parseWordsByLocale, type WordsByLocale } from "@/lib/price-words";
import { cleanWords, wordsProblems, type PriceWordProblem } from "@/lib/price-words-check";
import { isQuantityPicker, type QuantityPicker } from "@/lib/quantity-stepper";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { refreshTag } from "./refresh";
import { storeTag } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * How a store shows prices and quantities (D429, D430): decimals on whole amounts (the store's choice and each country's own), the words
 * before and after a product's price by language, and the quantity chooser on a product page. Read by the settings page; written only by
 * `savePriceDisplay()`, which refreshes the store's cache so its pages, markets and catalogue reads follow at once.
 */
export type PriceDisplay = {
  decimals: PriceDecimals;
  /** Each country the store keeps, with its own choice of decimals, null for the store's. */
  markets: { code: string; decimals: PriceDecimals | null }[];
  words: WordsByLocale;
  quantityPicker: QuantityPicker;
};

const storeRow = z.object({ price_decimals: col.text, price_words: z.unknown(), quantity_picker: col.text });
const marketRow = z.object({ code: col.text, price_decimals: col.textOrNull });

/** The store's price and quantity display as kept. */
export async function readPriceDisplay(storeId: string): Promise<PriceDisplay> {
  const [store, markets] = await Promise.all([
    typedRow(storeRow, sql`select price_decimals, price_words, quantity_picker from commerce.stores where id = ${storeId}::uuid`),
    typedRows(
      marketRow,
      sql`select code, price_decimals from commerce.markets m
        where m.store_id = ${storeId}::uuid and m.active
        order by (m.code = (select s.country from commerce.stores s where s.id = m.store_id)) desc nulls last, m.created_at, m.code`,
    ),
  ]);
  return {
    decimals: isPriceDecimals(store?.price_decimals) ? store.price_decimals : "always",
    markets: markets.map((m) => ({ code: m.code.trim(), decimals: isPriceDecimals(m.price_decimals) ? m.price_decimals : null })),
    words: parseWordsByLocale(store?.price_words),
    quantityPicker: isQuantityPicker(store?.quantity_picker) ? store.quantity_picker : "buttons",
  };
}

export type PriceDisplayProblem =
  | { kind: "decimals" }
  | { kind: "market"; code: string }
  | { kind: "picker" }
  | { kind: "word"; locale: string; place: "prefix" | "suffix"; problem: PriceWordProblem };

/**
 * Saves how the store shows prices and quantities (`settings:write`): every value checked again here (the words by `priceWordProblem()`),
 * the words kept only for the store's languages (`locales`, its kept ones) and each country's decimals only for its own active markets.
 * One transaction; the audit entry names what changed in kinds, never the words themselves.
 */
export async function savePriceDisplay(
  member: Membership,
  input: PriceDisplay,
  locales: readonly string[],
): Promise<{ ok: true } | { ok: false; problems: PriceDisplayProblem[] }> {
  const { store, account } = member;
  const problems: PriceDisplayProblem[] = [];
  if (!isPriceDecimals(input.decimals)) problems.push({ kind: "decimals" });
  if (!isQuantityPicker(input.quantityPicker)) problems.push({ kind: "picker" });
  const kept = await typedRows(marketRow, sql`select code, price_decimals from commerce.markets where store_id = ${store.id}::uuid and active`);
  const codes = new Set(kept.map((m) => m.code.trim()));
  for (const market of input.markets) {
    if (!codes.has(market.code) || (market.decimals !== null && !isPriceDecimals(market.decimals))) problems.push({ kind: "market", code: market.code });
  }
  for (const found of wordsProblems(input.words, locales)) problems.push({ kind: "word", ...found });
  if (problems.length > 0) return { ok: false, problems };

  const words = cleanWords(input.words, locales);
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.stores
      set price_decimals = ${input.decimals}, price_words = ${JSON.stringify(words)}::jsonb, quantity_picker = ${input.quantityPicker}
      where id = ${store.id}::uuid
    `);
    for (const market of input.markets) {
      await tx.execute(sql`
        update commerce.markets set price_decimals = ${market.decimals}
        where store_id = ${store.id}::uuid and code = ${market.code} and price_decimals is distinct from ${market.decimals}
      `);
    }
  });
  await audit(account.id, store.id, "store.price_display", {
    decimals: input.decimals,
    countries: Object.fromEntries(input.markets.filter((m) => m.decimals !== null).map((m) => [m.code, m.decimals])),
    languagesWithWords: Object.keys(words).filter((locale) => words[locale].prefix || words[locale].suffix),
    quantityPicker: input.quantityPicker,
  });
  // The markets carry the style (`Market.priceStyle`), which the catalogue's reads take as part of their key; both are refreshed.
  refreshTag(storeTag(store.slug));
  refreshTag(catalogTag(store.id));
  return { ok: true };
}
