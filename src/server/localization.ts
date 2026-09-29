import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ECB_RATES_URL, parseEcbRates, type EcbRates } from "@/lib/ecb";
import { defaultRoundTo, type StoreCurrency } from "@/lib/currency";
import { isOfferable } from "@/lib/localization";
import { isCurrency } from "@/lib/money";

import { audit, type Membership } from "./auth";
import { listLanguages } from "./languages";
import type { SaveResult } from "./settings";

/**
 * A store's languages and currencies (D109), chosen independently of each
 * other and of the countries it sells to. Languages are `stores.locales`, a
 * country's default language `markets.default_locale`; currencies are
 * `store_currencies`, whose rates are kept from the ECB's when `rates_auto`.
 */

const languageOf = (locale: string) => locale.split("-")[0];

/** Fetches today's ECB rates, or null when they cannot be read. */
export async function fetchEcbRates(): Promise<EcbRates | null> {
  try {
    const response = await fetch(ECB_RATES_URL, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!response.ok) return null;
    const parsed = parseEcbRates(await response.text());
    return parsed.rates.size > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Saves the store's languages, main first, and each country's default
 * language. A language a country shows by default cannot be taken away, and
 * a store has one variant of a language ("en-GB" or "en-IE", not both).
 */
export async function saveLanguages(
  { account, store }: Membership,
  locales: string[],
  marketLocales: Record<string, string>,
): Promise<SaveResult> {
  const problems: string[] = [];
  const unique = [...new Set(locales)];
  if (unique.length === 0) problems.push("Choose at least one language.");
  // The platform's languages that are on (D111).
  const offered = (await listLanguages()).filter((language) => language.enabled);
  const unknown = unique.filter((locale) => !isOfferable(offered, locale));
  if (unknown.length > 0) problems.push(`Not a language the store can offer: ${unknown.join(", ")}.`);
  const languages = unique.map(languageOf);
  if (new Set(languages).size !== languages.length) problems.push("Choose one variant of each language.");
  for (const market of store.markets) {
    const own = marketLocales[market.code] ?? market.ownLocale;
    if (!unique.some((locale) => languageOf(locale) === languageOf(own))) {
      problems.push(`${market.name} shows ${own} by default, so the store needs that language. Change the country's language first.`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  await db().transaction(async (tx) => {
    await tx.execute(sql`update commerce.stores set locales = ${sqlTextArray(unique)} where id = ${store.id}::uuid`);
    for (const market of store.markets) {
      const wanted = marketLocales[market.code];
      if (!wanted || wanted === market.ownLocale) continue;
      // The country's own language is one of the store's, in the variant the store chose.
      const chosen = unique.find((locale) => languageOf(locale) === languageOf(wanted)) ?? wanted;
      await tx.execute(sql`
        update commerce.markets
        set default_locale = ${chosen},
            locales = case when ${chosen} = any(locales) then locales else array_append(locales, ${chosen}) end
        where store_id = ${store.id}::uuid and code = ${market.code}
      `);
    }
  });
  await audit(account.id, store.id, "localization.languages", { locales: unique, marketLocales });
  return { ok: true };
}

function sqlTextArray(values: string[]) {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

export type CurrencyInput = { currency: string; rate: number | null; roundTo: number };

/**
 * Saves the currencies the store offers with their rates, and whether the
 * rates follow the ECB's. Each country's own currency stays (prices are in
 * it), the others need a rate to be shown.
 */
export async function saveCurrencies(
  { account, store }: Membership,
  rows: CurrencyInput[],
  ratesAuto: boolean,
): Promise<SaveResult> {
  const natives = new Set(store.markets.map((market) => market.nativeCurrency));
  const byCurrency = new Map<string, CurrencyInput>();
  for (const row of rows) if (isCurrency(row.currency)) byCurrency.set(row.currency, row);
  for (const native of natives) if (!byCurrency.has(native)) byCurrency.set(native, { currency: native, rate: native === "EUR" ? 1 : null, roundTo: defaultRoundTo(native) });

  let ecb: EcbRates | null = null;
  if (ratesAuto) {
    ecb = await fetchEcbRates();
    if (!ecb) return { ok: false, problems: ["The ECB's rates could not be fetched just now. Try again, or set the rates yourself."] };
  }

  const list: StoreCurrency[] = [];
  const problems: string[] = [];
  for (const row of byCurrency.values()) {
    if (row.currency === "EUR") {
      list.push({ currency: "EUR", rate: 1, roundTo: row.roundTo });
      continue;
    }
    const rate = ecb?.rates.get(row.currency) ?? row.rate;
    if (rate === null && !natives.has(row.currency)) problems.push(`${row.currency} needs a rate to be shown to shoppers.`);
    list.push({ currency: row.currency, rate, roundTo: Math.max(1, Math.round(row.roundTo)) });
  }
  if (problems.length > 0) return { ok: false, problems };

  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.store_currencies where store_id = ${store.id}::uuid`);
    let position = 0;
    for (const c of list) {
      await tx.execute(sql`
        insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
        values (${store.id}::uuid, ${c.currency}, ${c.rate}, ${c.roundTo}, ${position++})
      `);
    }
    await tx.execute(sql`
      update commerce.stores
      set rates_auto = ${ratesAuto}, rates_updated_at = ${ecb ? sql`now()` : sql`rates_updated_at`}
      where id = ${store.id}::uuid
    `);
  });
  await audit(account.id, store.id, "localization.currencies", { currencies: list.map((c) => c.currency), ratesAuto });
  return { ok: true };
}

/** Sets every offered currency's rate to the ECB's now, keeping the rounding steps. */
export async function fetchRatesNow({ account, store }: Membership): Promise<SaveResult> {
  const ecb = await fetchEcbRates();
  if (!ecb) return { ok: false, problems: ["The ECB's rates could not be fetched just now. Try again in a moment."] };
  const updated = await applyEcbRates(store.id, ecb);
  await audit(account.id, store.id, "localization.rates_fetched", { updated, date: ecb.date });
  return { ok: true, note: `Rates updated from the ECB${ecb.date ? ` (${ecb.date})` : ""}: ${updated} currencies.` };
}

async function applyEcbRates(storeId: string, ecb: EcbRates): Promise<number> {
  let updated = 0;
  for (const [currency, rate] of ecb.rates) {
    const rows = await db().execute<{ currency: string }>(sql`
      update commerce.store_currencies set rate = ${rate}
      where store_id = ${storeId}::uuid and currency = ${currency}
      returning currency
    `);
    updated += rows.length;
  }
  await db().execute(sql`update commerce.stores set rates_updated_at = now() where id = ${storeId}::uuid`);
  return updated;
}

/**
 * Daily: stores that keep their rates from the ECB's get the latest.
 * Returns the stores changed, whose caches the caller clears.
 */
export async function refreshAutoRates(): Promise<{ id: string; slug: string }[]> {
  const stores = await db().execute<{ id: string; slug: string }>(sql`select id, slug from commerce.stores where rates_auto`);
  if (stores.length === 0) return [];
  const ecb = await fetchEcbRates();
  if (!ecb) return [];
  for (const store of stores) await applyEcbRates(store.id, ecb);
  return [...stores];
}
