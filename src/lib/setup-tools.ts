import { z } from "zod";

import { ROUND_STEPS, defaultRoundTo, stepMinor, type StoreCurrency } from "./currency";
import { OFFERABLE_CURRENCIES } from "./money";
import { parsePrice } from "./product-input";
import { ESTIMATE_DAYS_MAX, NAME_MAX, TIERS_MAX } from "./shipping-limits";

/**
 * The AI manager's setup tools (D308, `docs/ai-autopilot.md` 5), pure: their arguments, how a change is laid over what the store has, the setup's
 * steps in words and the sentences an approval shows. The server (`src/server/setup-tools.ts`) saves only through the savers the setup wizard and
 * the Settings pages call (`saveStoreDetails()`, `setMarkets()`, `saveLanguages()`, `saveCurrencies()`, `saveShippingSettings()`,
 * `saveShippingMethod()`, `completeSetup()`), so each change is checked by the screen's own rules.
 *
 * While the store is being set up nothing of it is public (its storefront is a preview, never indexed), so these tools run at once; once it is
 * open, a change waits for the owner's yes (`GATED_WHEN_OPEN`). Opening it always does.
 */

/** The setup tools that change what shoppers see once the store is open: free while it is being set up, waiting for a yes after. */
export const GATED_WHEN_OPEN: ReadonlySet<string> = new Set([
  "set_store_details",
  "set_countries",
  "set_languages",
  "set_currencies",
  "set_flat_shipping",
  "save_shipping_method",
]);

/** Every setup tool that changes the store, audited in the Settings area. */
export const SETUP_TOOLS: ReadonlySet<string> = new Set([...GATED_WHEN_OPEN, "open_store"]);

const countryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "A country by its two-letter code, such as NO or SE.");
const locale = z.string().trim().min(2).max(10);
const amount = z.string().trim().min(1).max(20);
const atLeastOne = (value: Record<string, unknown>) => Object.values(value).some((v) => v !== undefined);

export const setStoreDetailsInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional().describe("The store's name, as shoppers see it."),
    legal_name: z.string().trim().min(1).max(200).optional().describe("The business's legal name, as it is registered."),
    organisation_number: z.string().trim().max(40).nullable().optional().describe("The business's organisation number; null takes it away."),
    contact_email: z.string().trim().max(200).optional().describe("The email shoppers can write to."),
    postal_address: z.string().trim().max(300).optional().describe("The business's postal address."),
    country: countryCode.optional().describe("The country the business is registered in, by its two-letter code."),
  })
  .refine(atLeastOne, "Give at least one detail to change.");

export const setCountriesInput = z.object({
  countries: z
    .array(countryCode)
    .min(1, "Choose at least one country.")
    .max(60)
    .describe(
      "Every country the store sells to, by two-letter code: the whole list. A country left out is no longer offered; its prices and settings are kept for when it comes back. With Several countries off (Settings, Features) it is one country.",
    ),
});

export const setLanguagesInput = z
  .object({
    main: locale.optional().describe("The store's main language, which everything is written in first: a language (nb, sv, en) or a locale (nb-NO, en-GB)."),
    others: z
      .array(locale)
      .max(20)
      .optional()
      .describe("The other languages offered beside the main one, the whole list ([] for none); needs Several languages on (Settings, Features). Left out, they stay as they are."),
    countries: z
      .record(countryCode, locale)
      .optional()
      .describe('The language a country is shown in by default, by country code, such as {"NO": "en"}. Left out, each country keeps its own.'),
  })
  .refine(atLeastOne, "Give the main language, the other languages or a country's language.");

const roundStep = z
  .number()
  .refine((step) => (ROUND_STEPS as readonly number[]).includes(step), `Rounding is one of ${ROUND_STEPS.join(", ")}.`)
  .describe(`Converted prices are rounded to a multiple of this, in whole units of the currency: one of ${ROUND_STEPS.join(", ")} (0 is the smallest unit).`);

export const setCurrenciesInput = z
  .object({
    add: z
      .array(
        z.object({
          currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "A currency by its three-letter code, such as EUR.").describe("Such as EUR or SEK."),
          rate: z.number().positive().max(1_000_000).optional().describe("How many of the currency one euro buys, as the ECB gives it (such as 11.5 for SEK). Not needed while the rates follow the ECB's."),
          round_to: roundStep.optional(),
        }),
      )
      .max(20)
      .optional()
      .describe("Currencies to offer, or to change the rate or rounding of. Needs Several currencies on (Settings, Features)."),
    remove: z
      .array(z.string().trim().regex(/^[A-Za-z]{3}$/))
      .max(20)
      .optional()
      .describe("Currencies to stop offering. A country's own currency stays: its prices are in it."),
    rates_follow_ecb: z.boolean().optional().describe("Keep every rate at the European Central Bank's, updated each day."),
  })
  .refine(atLeastOne, "Give currencies to add or remove, or whether the rates follow the ECB's.");

export const setFlatShippingInput = z.object({
  rates: z
    .array(
      z.object({
        country: countryCode,
        price: amount.describe('The shipping price, with VAT, as text in the country\'s own currency: "79" or "79,50"; "0" is free.'),
        free_over: amount
          .nullable()
          .optional()
          .describe("Free shipping when the basket is worth at least this, as text in the same currency; null takes it away; left out, it stays as it is."),
      }),
    )
    .min(1)
    .max(60)
    .describe("The countries to change; the others keep their rate."),
});

const tierArgs = z.object({
  by: z.enum(["flat", "weight", "value"]).describe("flat: one price; weight: by the parcel's weight in grams; value: by the basket's value."),
  from: z
    .union([z.number(), z.string().trim().max(20)])
    .optional()
    .describe("Where the tier starts: grams for weight, an amount as text for value; 0 (left out) for the first. Not for flat."),
  up_to: z
    .union([z.number(), z.string().trim().max(20)])
    .nullable()
    .optional()
    .describe("Where it ends, in the same unit, where the next starts; left out or null for the last. Not for flat."),
  price: amount.describe('The price, with VAT, as text in the country\'s own currency: "79" or "79,50"; "0" is free.'),
});

const rateArgs = z.object({
  zone: z.string().trim().max(200).nullable().optional().describe("A shipping zone of the country by its name or id (shipping_overview lists them); left out or null: the rest of the country."),
  profile: z.string().trim().max(200).nullable().optional().describe("A shipping profile by its name or id; left out or null: General, every product not in another profile."),
  tiers: z
    .array(tierArgs)
    .max(TIERS_MAX)
    .describe("One flat price, or tiers that meet with no gap (the first from 0, each from where the one before ends, only the last open); [] is not offered there."),
});

export const saveShippingMethodInput = z.object({
  method: z.string().trim().min(1).max(200).optional().describe("The method to change, by its name in that country or its id (shipping_overview); left out to make a new one."),
  country: countryCode.describe("The country the method is for."),
  name: z.string().trim().min(1).max(NAME_MAX).optional().describe("Its name as shoppers see it, in the main language, such as Home delivery. Needed for a new method."),
  names: z.record(locale, z.string().trim().max(NAME_MAX)).optional().describe("Its name in the store's other languages, by locale."),
  transit_days: z
    .object({ min: z.number().int().min(0).max(ESTIMATE_DAYS_MAX), max: z.number().int().min(0).max(ESTIMATE_DAYS_MAX) })
    .nullable()
    .optional()
    .describe("How many days delivery takes, such as {min: 1, max: 3}; null takes it away."),
  free_over: amount.nullable().optional().describe("Free with this method when the basket is worth at least this, as text in the country's own currency; null takes it away."),
  active: z.boolean().optional().describe("Offered at checkout; a new method is offered unless false."),
  rates: z
    .array(rateArgs)
    .min(1)
    .max(40)
    .optional()
    .describe("Its prices, every block of them: they replace the method's. Needed for a new method; left out, a change keeps them."),
});

export type StoreDetailsArgs = z.output<typeof setStoreDetailsInput>;
export type LanguagesArgs = z.output<typeof setLanguagesInput>;
export type CurrenciesArgs = z.output<typeof setCurrenciesInput>;
export type FlatShippingArgs = z.output<typeof setFlatShippingInput>;
export type ShippingMethodArgs = z.output<typeof saveShippingMethodInput>;

// Store details --------------------------------------------------------------------------------

export type DetailsNow = {
  name: string;
  legalName: string | null;
  organisationNumber: string | null;
  contactEmail: string | null;
  postalAddress: string | null;
  country: string | null;
};

const DETAIL_WORDS: Record<keyof DetailsNow, string> = {
  name: "the name",
  legalName: "the legal name",
  organisationNumber: "the organisation number",
  contactEmail: "the contact email",
  postalAddress: "the address",
  country: "the country",
};

/** The details form's fields as the owner would send them: what is given laid over what the store has, for `storeDetailsInput` to check. */
export function detailsOver(now: DetailsNow, args: StoreDetailsArgs): Record<keyof DetailsNow, string> {
  return {
    name: args.name ?? now.name,
    legalName: args.legal_name ?? now.legalName ?? "",
    organisationNumber: (args.organisation_number === undefined ? now.organisationNumber : args.organisation_number) ?? "",
    contactEmail: args.contact_email ?? now.contactEmail ?? "",
    postalAddress: args.postal_address ?? now.postalAddress ?? "",
    country: args.country?.toUpperCase() ?? now.country ?? "",
  };
}

/** "Change the store's details: the name to "Fjord", the contact email to "hei@fjord.no"." from what the change would make of them. */
export function detailsSummary(now: DetailsNow, next: Record<keyof DetailsNow, string | null>): string {
  const parts = (Object.keys(DETAIL_WORDS) as (keyof DetailsNow)[])
    .filter((key) => (next[key] || null) !== (now[key] || null))
    .map((key) => (next[key] ? `${DETAIL_WORDS[key]} to "${next[key]}"` : `take away ${DETAIL_WORDS[key]}`));
  return parts.length === 0 ? "Keep the store's details as they are." : `Change the store's details: ${parts.join(", ")}.`;
}

// Countries ------------------------------------------------------------------------------------

const list = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** "Sell in Norway and Sweden: add Sweden, stop offering Denmark." */
export function countriesSummary(before: readonly string[], after: readonly string[], nameOf: (code: string) => string): string {
  const added = after.filter((code) => !before.includes(code)).map(nameOf);
  const gone = before.filter((code) => !after.includes(code)).map(nameOf);
  const changes = [added.length > 0 ? `add ${list(added)}` : "", gone.length > 0 ? `stop offering ${list(gone)} (its prices and settings are kept)` : ""].filter(Boolean);
  return `Sell in ${list(after.map(nameOf))}${changes.length > 0 ? `: ${changes.join(", ")}` : ""}.`;
}

// Languages ------------------------------------------------------------------------------------

const langOf = (value: string) => value.split("-")[0].toLowerCase();

/**
 * A language as the model names it ("en", "en-GB", "Nb-no") as one of the platform's locales: the locale itself when it is offered, else the
 * variant of that language the store already has, else the language's first. Null for one the platform does not offer.
 */
export function resolveLocale(wanted: string, offered: readonly { lang: string; locales: readonly string[] }[], kept: readonly string[]): string | null {
  const exact = offered.flatMap((l) => l.locales).find((l) => l.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact;
  const lang = langOf(wanted);
  const language = offered.find((l) => l.lang === lang);
  if (!language || language.locales.length === 0) return null;
  return kept.find((l) => langOf(l) === lang && language.locales.includes(l)) ?? language.locales[0];
}

/** A locale in English words: "Norwegian Bokmål (Norway)", the code itself where none is known. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The store's languages, main first, from what is given: the main one moved to the front, the others replaced only when given. */
export function languagesOver(current: readonly string[], main: string | null, others: readonly string[] | null): string[] {
  const first = main ?? current[0];
  // The main language before stays among the others when they are not given.
  const rest = (others ?? current).filter((l) => langOf(l) !== langOf(first ?? ""));
  const byLang = new Map<string, string>();
  for (const l of [first, ...rest].filter((x): x is string => Boolean(x))) if (!byLang.has(langOf(l))) byLang.set(langOf(l), l);
  return [...byLang.values()];
}

/** "Make English (United Kingdom) the main language; offer Swedish beside it; show Norway in English (United Kingdom)." */
export function languagesSummary(locales: readonly string[], byCountry: Record<string, string>, nameOf: (code: string) => string): string {
  const [main, ...others] = locales;
  const parts = [
    main ? `Make ${languageName(main)} the main language` : "",
    others.length > 0 ? `offer ${list(others.map(languageName))} beside it` : "",
    ...Object.entries(byCountry).map(([code, l]) => `show ${nameOf(code)} in ${languageName(l)}`),
  ].filter(Boolean);
  return `${parts.join("; ")}.`;
}

// Currencies -----------------------------------------------------------------------------------

export type CurrencyRow = { currency: string; rate: number | null; roundTo: number };

/**
 * The currencies to save: what the store offers, with the ones given added or changed and the ones removed taken away. A country's own currency
 * is never removed, and one that is not the platform's is refused; a currency with no rate needs one unless the rates follow the ECB's.
 */
export function currenciesOver(
  current: readonly StoreCurrency[],
  args: CurrenciesArgs,
  natives: ReadonlySet<string>,
  ratesFollowEcb: boolean,
): { rows: CurrencyRow[]; problems: string[] } {
  const rows = new Map(current.map((c) => [c.currency, { currency: c.currency, rate: c.rate, roundTo: c.roundTo }]));
  const problems: string[] = [];
  for (const raw of args.remove ?? []) {
    const code = raw.toUpperCase();
    if (natives.has(code)) problems.push(`${code} is a country's own currency, which its prices are in, so it stays.`);
    else rows.delete(code);
  }
  for (const add of args.add ?? []) {
    const code = add.currency.toUpperCase();
    if (!(OFFERABLE_CURRENCIES as readonly string[]).includes(code)) {
      problems.push(`${code} is not a currency stores can offer: ${OFFERABLE_CURRENCIES.join(", ")}.`);
      continue;
    }
    const was = rows.get(code);
    rows.set(code, {
      currency: code,
      rate: code === "EUR" ? 1 : (add.rate ?? was?.rate ?? null),
      roundTo: add.round_to !== undefined ? stepMinor(code, add.round_to) : (was?.roundTo ?? defaultRoundTo(code)),
    });
  }
  if (!ratesFollowEcb) {
    for (const row of rows.values()) {
      if (row.rate === null && row.currency !== "EUR" && !natives.has(row.currency)) problems.push(`${row.currency} needs a rate to be shown to shoppers, or let the rates follow the ECB's.`);
    }
  }
  return { rows: [...rows.values()], problems };
}

/** "Offer NOK, EUR (rounded to 0.1) and SEK at 11.5 per euro; stop offering DKK; the rates follow the ECB's." */
export function currenciesSummary(before: readonly string[], rows: readonly CurrencyRow[], ratesFollowEcb: boolean): string {
  const shown = rows.map((r) => `${r.currency}${!ratesFollowEcb && r.rate !== null && r.currency !== "EUR" ? ` at ${r.rate} per euro` : ""}`);
  const gone = before.filter((c) => !rows.some((r) => r.currency === c));
  return [`Offer ${list(shown)}`, gone.length > 0 ? `stop offering ${list(gone)}` : "", ratesFollowEcb ? "the rates follow the ECB's" : ""].filter(Boolean).join("; ") + ".";
}

// Flat-rate shipping ---------------------------------------------------------------------------

export type MarketMoney = { code: string; name: string; currency: string };
export type FlatRateNow = { marketCode: string; amountMinor: number | null; freeOverMinor: number | null };
export type FlatRate = { marketCode: string; amountMinor: number; freeOverMinor: number | null };

/** The flat rates to save, read in each country's own currency; a free-over left out keeps the country's own. */
export function flatRatesOver(now: readonly FlatRateNow[], args: FlatShippingArgs, markets: readonly MarketMoney[]): { rates: FlatRate[]; problems: string[] } {
  const rates: FlatRate[] = [];
  const problems: string[] = [];
  for (const rate of args.rates) {
    const code = rate.country.toUpperCase();
    const market = markets.find((m) => m.code === code);
    if (!market) {
      problems.push(`The store does not sell to ${code}: its countries are ${markets.map((m) => m.code).join(", ") || "none yet"} (set_countries adds one).`);
      continue;
    }
    const amountMinor = parsePrice(rate.price, market.currency);
    if (amountMinor === null) {
      problems.push(`${market.name}: "${rate.price}" is not an amount in ${market.currency}.`);
      continue;
    }
    let freeOverMinor = now.find((r) => r.marketCode === code)?.freeOverMinor ?? null;
    if (rate.free_over === null) freeOverMinor = null;
    else if (rate.free_over !== undefined) {
      const free = parsePrice(rate.free_over, market.currency);
      if (free === null || free <= 0) {
        problems.push(`${market.name}: "${rate.free_over}" is not an amount in ${market.currency}.`);
        continue;
      }
      freeOverMinor = free;
    }
    rates.push({ marketCode: code, amountMinor, freeOverMinor });
  }
  return { rates, problems };
}

/** "Charge shipping of NOK 79.00 in Norway (free over NOK 1,000.00) and SEK 69.00 in Sweden." */
export function flatShippingSummary(rates: readonly FlatRate[], markets: readonly MarketMoney[], money: (minor: number, currency: string) => string): string {
  const words = rates.map((r) => {
    const m = markets.find((x) => x.code === r.marketCode);
    const currency = m?.currency ?? "";
    const price = r.amountMinor === 0 ? "free shipping" : money(r.amountMinor, currency);
    return `${price} in ${m?.name ?? r.marketCode}${r.freeOverMinor === null ? "" : ` (free over ${money(r.freeOverMinor, currency)})`}`;
  });
  return `Charge shipping of ${list(words)}.`;
}

// Shipping methods -----------------------------------------------------------------------------

export type MethodNow = {
  id: string;
  marketCode: string;
  name: string;
  names: Record<string, string>;
  estimate: { min: number; max: number } | null;
  freeOverMinor: number | null;
  active: boolean;
  rates: { zoneId: string | null; profileId: string | null; basis: "flat" | "weight" | "value"; minValue: number; maxValue: number | null; amountMinor: number }[];
};
export type Named = { id: string; name: string };

/** The `methodInput` the editor would send for this change: the method as it is (or a new one) with what is given laid over it. */
export function methodOver(
  existing: MethodNow | null,
  args: ShippingMethodArgs,
  facts: { currency: string; zones: readonly Named[]; profiles: readonly Named[] },
): { ok: true; input: Record<string, unknown> } | { ok: false; problem: string } {
  const country = args.country.toUpperCase();
  if (!existing && !args.name) return { ok: false, problem: "A new method needs a name, such as Home delivery." };
  if (!existing && !args.rates) return { ok: false, problem: "A new method needs its prices (rates)." };
  const pick = (kind: "zone" | "profile", ref: string | null | undefined, from: readonly Named[]): { id: string | null } | { problem: string } => {
    if (ref === undefined || ref === null || ref === "") return { id: null };
    if (kind === "profile" && ref.toLowerCase() === "general") return { id: null };
    const found = from.find((x) => x.id === ref || x.name.toLowerCase() === ref.toLowerCase());
    return found ? { id: found.id } : { problem: `No shipping ${kind} "${ref}"${kind === "zone" ? ` in ${country}` : ""}: shipping_overview lists them.` };
  };
  const value = (v: number | string | null | undefined, basis: "weight" | "value", fallback: number | null): number | null | "invalid" => {
    if (v === undefined || v === null || v === "") return fallback;
    if (basis === "weight") {
      const grams = typeof v === "number" ? v : Number(String(v).replace(/\s/g, ""));
      return Number.isSafeInteger(grams) && grams >= 0 ? grams : "invalid";
    }
    const minor = parsePrice(String(v), facts.currency);
    return minor === null ? "invalid" : minor;
  };
  let groups: Record<string, unknown>[] | undefined;
  if (args.rates) {
    groups = [];
    for (const block of args.rates) {
      const zone = pick("zone", block.zone, facts.zones);
      if ("problem" in zone) return { ok: false, problem: zone.problem };
      const profile = pick("profile", block.profile, facts.profiles);
      if ("problem" in profile) return { ok: false, problem: profile.problem };
      const tiers: Record<string, unknown>[] = [];
      for (const tier of block.tiers) {
        const amountMinor = parsePrice(tier.price, facts.currency);
        if (amountMinor === null) return { ok: false, problem: `"${tier.price}" is not an amount in ${facts.currency}.` };
        if (tier.by === "flat") {
          tiers.push({ basis: "flat", minValue: 0, maxValue: null, amountMinor });
          continue;
        }
        const minValue = value(tier.from, tier.by, 0);
        const maxValue = value(tier.up_to, tier.by, null);
        if (minValue === "invalid" || maxValue === "invalid" || minValue === null) {
          return { ok: false, problem: tier.by === "weight" ? "A weight tier's from and up to are whole grams." : `A value tier's from and up to are amounts in ${facts.currency}.` };
        }
        tiers.push({ basis: tier.by, minValue, maxValue, amountMinor });
      }
      groups.push({ zoneId: zone.id, profileId: profile.id, tiers });
    }
  }
  const freeOverMinor =
    args.free_over === undefined ? (existing?.freeOverMinor ?? null) : args.free_over === null ? null : parsePrice(args.free_over, facts.currency);
  if (args.free_over && (freeOverMinor === null || freeOverMinor <= 0)) return { ok: false, problem: `"${args.free_over}" is not an amount in ${facts.currency}.` };
  return {
    ok: true,
    input: {
      id: existing?.id ?? null,
      marketCode: country,
      name: args.name ?? existing?.name ?? "",
      names: { ...(existing?.names ?? {}), ...(args.names ?? {}) },
      estimate: args.transit_days === undefined ? (existing?.estimate ?? null) : args.transit_days,
      freeOverMinor,
      active: args.active ?? existing?.active ?? true,
      groups:
        groups ??
        Object.values(
          (existing?.rates ?? []).reduce<Record<string, { zoneId: string | null; profileId: string | null; tiers: unknown[] }>>((acc, r) => {
            const key = `${r.zoneId ?? "-"}|${r.profileId ?? "-"}`;
            acc[key] ??= { zoneId: r.zoneId, profileId: r.profileId, tiers: [] };
            acc[key].tiers.push({ basis: r.basis, minValue: r.minValue, maxValue: r.maxValue, amountMinor: r.amountMinor });
            return acc;
          }, {}),
        ),
    },
  };
}

type MethodWordsInput = { name: string; active: boolean; freeOverMinor: number | null; estimate: { min: number; max: number } | null; groups: { tiers: { basis: string; amountMinor: number }[] }[] };

/** "Make the shipping method "Home delivery" in Norway: NOK 79.00, free over NOK 1,000.00, 1–3 days." */
export function methodSummary(isNew: boolean, method: MethodWordsInput, countryName: string, currency: string, money: (minor: number, currency: string) => string): string {
  const offered = method.groups.filter((g) => g.tiers.length > 0);
  const flat = offered.length === 1 && offered[0].tiers.length === 1 && offered[0].tiers[0].basis === "flat" ? offered[0].tiers[0].amountMinor : null;
  const prices = flat !== null ? (flat === 0 ? "free" : money(flat, currency)) : `${offered.length} ${offered.length === 1 ? "block" : "blocks"} of prices`;
  const facts = [
    prices,
    method.freeOverMinor === null ? "" : `free over ${money(method.freeOverMinor, currency)}`,
    method.estimate ? `${method.estimate.min === method.estimate.max ? method.estimate.min : `${method.estimate.min}–${method.estimate.max}`} days` : "",
    method.active ? "" : "not offered at checkout",
  ].filter(Boolean);
  return `${isNew ? "Make" : "Change"} the shipping method "${method.name}" in ${countryName}: ${facts.join(", ")}.`;
}

// The setup's steps ----------------------------------------------------------------------------

/** What `getSetupProgress()` says is done, as far as the steps read it. */
export type SetupDone = {
  features: boolean;
  details: boolean;
  countries: boolean;
  bookings: boolean;
  shipping: boolean;
  payments: boolean;
  paymentsOn: boolean;
  products: boolean;
  plan: boolean;
  readyToOpen: boolean;
};

export type SetupFacts = {
  done: SetupDone;
  /** The store is open to shoppers (`setup_completed_at`). */
  open: boolean;
  /** The online shop is on (a website has no shipping, payments or products to set up). */
  selling: boolean;
  /** Appointments or stays and rentals is on, so people are booked. */
  booked: boolean;
  /** Domains added and waiting for their DNS records. */
  pendingDomains: readonly string[];
  /** Carriers connected under Integrations. */
  carriers: number;
};

export type SetupStepWords = {
  step: string;
  done: boolean;
  page: string;
  /** The tools that do it; none when only the owner can. */
  tools?: string[];
  /** For the owner: the one thing to do on the page. */
  owner_does?: string;
  /** Not needed to open. */
  optional?: true;
};

/**
 * The setup in words, in the wizard's order: each step with its page and either the tools that do it or, where only the owner can (identity and
 * money with the payment provider, the plan, the bookable people and places), the one thing to do there; `next` is the first step left, and
 * `owner_only` lists what waits on the owner, with a domain's DNS records and a carrier's agreement as optional. `path` makes a page's address.
 */
export function setupStatus(facts: SetupFacts, path: (page: string) => string) {
  const { done } = facts;
  const steps: SetupStepWords[] = [
    ...(facts.open
      ? []
      : [{ step: "What the store will sell (Settings, Features)", done: done.features, page: path("/setup/features"), tools: ["list_features", "set_feature"], optional: true as const }]),
    { step: "Business details", done: done.details, page: path("/settings/company"), tools: ["set_store_details"] },
    { step: facts.selling ? "Countries to sell to" : "The website's country", done: done.countries, page: path("/settings/countries"), tools: ["set_countries"] },
    ...(facts.booked
      ? [{ step: "Staff, rooms or items to book", done: done.bookings, page: path("/setup/bookings"), owner_does: "Add the staff, rooms or items people book, with their hours." }]
      : []),
    ...(facts.selling
      ? [
          { step: "Shipping price for every country", done: done.shipping, page: path("/settings/shipping"), tools: ["set_flat_shipping", "save_shipping_method"] },
          {
            step: "Payments account (Stripe or Mollie)",
            done: done.payments,
            page: path("/settings/payments"),
            owner_does: "Give Stripe your identity and bank account in its own form there, or connect Mollie: only you can.",
          },
          { step: "Payments switched on", done: done.paymentsOn, page: path("/settings/payments"), owner_does: "Switch payments on, once the account is ready." },
          { step: "Own products (not only the demo ones)", done: done.products, page: path("/products"), tools: ["create_product"] },
        ]
      : []),
    { step: "A Kaizena Flow plan", done: done.plan, page: path("/billing"), owner_does: "Choose a plan and how to pay for it." },
    { step: "Open the store", done: facts.open, page: path("/setup/launch"), tools: ["open_store"] },
  ];
  const left = steps.filter((s) => !s.done && !s.optional);
  const ownerOnly = [
    ...left.filter((s) => s.owner_does).map((s) => ({ what: s.step, page: s.page, do: s.owner_does! })),
    ...facts.pendingDomains.map((host) => ({ what: `The domain ${host}`, page: path("/settings/domains"), do: "Add the DNS records shown there at the domain's registrar.", optional: true as const })),
    ...(facts.selling && facts.carriers === 0
      ? [{ what: "A carrier at checkout (optional)", page: path("/integrations"), do: "Connect your own agreement with Bring, PostNord, Porterbuddy or Helthjem to offer their services.", optional: true as const }]
      : []),
  ];
  return {
    open: facts.open,
    ready_to_open: done.readyToOpen,
    steps,
    next: left[0] ?? null,
    owner_only: ownerOnly,
    note: facts.open
      ? "The store is open: a change to its details, countries, languages, currencies or shipping waits for the owner's yes."
      : "To open, the store needs its business details and a country; while it is being set up, the setup tools change it at once (its storefront is a preview shoppers cannot find). What only the owner can do is theirs: say the page and the one thing to do there, never try it.",
  };
}

/** The approval's sentence for opening the store: what opening does, and what it will not do yet. */
export function openSummary(storeName: string, facts: { selling: boolean; paymentsOn: boolean }): string {
  if (!facts.selling) return `Open ${storeName}: its website becomes public and search engines may list it.`;
  return `Open ${storeName} to shoppers: its pages become public, search engines may list it${facts.paymentsOn ? " and it takes orders" : ", and it takes no payment until payments are switched on"}.`;
}
