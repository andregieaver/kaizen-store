import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { oneLanguageChoice } from "@/lib/localization";
import { formatMoney } from "@/lib/money";
import type { PermissionHolder } from "@/lib/permissions";
import { stepApplies } from "@/lib/setup-steps";
import {
  GATED_WHEN_OPEN,
  countriesSummary,
  currenciesOver,
  currenciesSummary,
  detailsOver,
  detailsSummary,
  flatRatesOver,
  flatShippingSummary,
  languageName,
  languagesOver,
  languagesSummary,
  methodOver,
  methodSummary,
  openSummary,
  resolveLocale,
  setupStatus,
  type CurrenciesArgs,
  type DetailsNow,
  type FlatShippingArgs,
  type LanguagesArgs,
  type ShippingMethodArgs,
  type StoreDetailsArgs,
} from "@/lib/setup-tools";
import { methodInput } from "@/lib/shipping-methods-schema";
import { storeDetailsInput } from "@/lib/store-details";
import { featureOffText, featureOn } from "@/lib/store-features";

import type { Account, Membership } from "./auth";
import { catalogTag } from "./catalog";
import { listStoreDomains } from "./domains";
import { listLanguages } from "./languages";
import { languagesProblems, saveCurrencies, saveLanguages } from "./localization";
import { OwnerToolError } from "./owner-tool-error";
import { pagesTag } from "./pages";
import { forgetStoreFacts } from "./redirect-resolve";
import { STORES_TAG } from "./seo";
import { getShippingSettings, saveShippingSettings } from "./settings";
import { completeSetup, getSetupProgress, saveStoreDetails, setMarkets } from "./setup";
import { listCarriers } from "./shipping-carriers";
import { getShippingSetup, saveShippingMethod } from "./shipping-methods";
import { currentStore, storeTag, type Store } from "./stores";
import { chargeDueThemePurchases } from "./theme-prices";

type Row = Record<string, unknown>;

/**
 * The AI manager's setup tools (D308, `docs/ai-autopilot.md` 5): the store's details, countries, languages, currencies, flat-rate shipping and
 * shipping methods, what is left before it opens, and opening it. Each saves only through the saver its screen calls, with the screen's checks,
 * and refreshes the caches the screen refreshes. The store is read again from the database for each call (`currentStore()`), since a turn may
 * add a country and price its shipping one call after the other while the cache still serves the store as it was.
 *
 * While the store is being set up these run at once; once it is open a change waits for the owner's yes (`setupGateNeeded()`), checked first by
 * `preflightSetupTool()` so nothing that would be refused is ever waiting. What only the owner can do (the payment provider's identity and bank
 * details, the plan, a domain's DNS records, a carrier's agreement) is said by `setup_progress`, never tried.
 */

export type SetupToolContext = { account: Account; store: Store; invalidate: (tag: string) => void; holder?: PermissionHolder };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const member = (ctx: SetupToolContext, store: Store): Membership => ({ account: ctx.account, store, role: ctx.holder?.role ?? "owner" });
const adminPage = (store: Store, page: string) => `/admin/${store.slug}${page}`;
const money = (store: Store) => (minor: number, currency: string) => formatMoney(minor, currency, store.markets[0]?.locale ?? "en");

/** A country in English words, "Norway", the code where none is known. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The store as it is now, for a change: a store that is closed or suspended is not set up further. */
async function storeNow(ctx: SetupToolContext): Promise<Store> {
  const store = (await currentStore(ctx.store.slug)) ?? fail("The store could not be read.");
  if (store.status === "closed") return fail("The store is closed, so its setup is not changed. The owner can reopen it under Settings, Close the store.");
  if (store.status !== "active") return fail("The store is suspended by Kaizena Flow, so its setup is not changed.");
  return store;
}

/** What the store's pages, catalogue, addresses and the platform's lists of stores read about it, refreshed after a change. */
function refreshStore(ctx: SetupToolContext, store: Store, { pages = false }: { pages?: boolean } = {}) {
  ctx.invalidate(storeTag(store.slug));
  ctx.invalidate(catalogTag(store.id));
  ctx.invalidate(STORES_TAG);
  if (pages) ctx.invalidate(pagesTag(store.id));
  // The shape of its addresses (D181), as the proxy reads it.
  forgetStoreFacts(store.slug);
}

/** After the answer, as the wizard's Open button does: a premium theme live at opening is invoiced (D286). */
function afterAnswer(run: () => Promise<unknown>): void {
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch {
        // Not in a request: the five-minute job invoices it.
      }
    })
    .catch(() => undefined);
}

/** Whether a setup tool needs the owner's yes for this call: opening always; the rest only once the store is open to shoppers. */
export async function setupGateNeeded(store: Store, name: string): Promise<boolean> {
  if (name === "open_store") return true;
  if (!GATED_WHEN_OPEN.has(name)) return true;
  const [row] = await db().execute<Row>(sql`select setup_completed_at is not null as open from commerce.stores where id = ${store.id}::uuid`);
  return Boolean(row?.open);
}

// Store details --------------------------------------------------------------------------------

async function prepareDetails(ctx: SetupToolContext, args: StoreDetailsArgs) {
  const store = await storeNow(ctx);
  const now: DetailsNow = { name: store.name, ...store.details };
  const parsed = storeDetailsInput.safeParse(detailsOver(now, args));
  if (!parsed.success) return fail([...new Set(parsed.error.issues.map((issue) => issue.message))].join(" "));
  const [known] = await db().execute<Row>(sql`select 1 as ok from commerce.countries where code = ${parsed.data.country}`);
  if (!known) return fail(`${parsed.data.country} is not a country Kaizena Flow knows.`);
  return { store, now, input: parsed.data };
}

/** `set_store_details` (owner): the business behind the store, laid over what it has, saved as the Company page and the wizard save it. */
export async function setStoreDetailsTool(ctx: SetupToolContext, args: StoreDetailsArgs) {
  const { store, now, input } = await prepareDetails(ctx, args);
  const summary = detailsSummary(now, input);
  if (summary.startsWith("Keep")) return { done: "Nothing changed: the details are already so.", page: adminPage(store, "/settings/company") };
  await saveStoreDetails(member(ctx, store), input);
  refreshStore(ctx, store);
  return { done: summary.replace(/^Change/, "Changed"), page: adminPage(store, "/settings/company") };
}

// Countries ------------------------------------------------------------------------------------

async function prepareCountries(ctx: SetupToolContext, args: { countries: string[] }) {
  const store = await storeNow(ctx);
  const codes = [...new Set(args.countries.map((code) => code.toUpperCase()))];
  if (!featureOn(store, "countries") && codes.length > 1) {
    return fail(`${featureOffText("countries")} The store sells in one country: choose one, or switch Several countries on first (set_feature).`);
  }
  const known = await db().execute<Row>(sql`select code from commerce.countries where code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`);
  const unknown = codes.filter((code) => !known.some((row) => String(row.code).trim() === code));
  if (unknown.length > 0) return fail(`Not a country Kaizena Flow knows: ${unknown.join(", ")}.`);
  return { store, codes, before: store.keptMarkets.map((m) => m.code) };
}

/** `set_countries` (`settings:write`): the countries the store sells to, the whole list, through the wizard's `setMarkets()`. */
export async function setCountriesTool(ctx: SetupToolContext, args: { countries: string[] }) {
  const { store, codes, before } = await prepareCountries(ctx, args);
  const result = await setMarkets(member(ctx, store), codes);
  if (!result.ok) return fail(result.problems.join(" "));
  refreshStore(ctx, store, { pages: true });
  const after = (await currentStore(store.slug)) ?? store;
  const priced = new Set((await getShippingSettings(after)).filter((r) => r.amountMinor !== null).map((r) => r.marketCode));
  const unpriced = featureOn(after, "shop") ? after.markets.filter((m) => !priced.has(m.code)).map((m) => countryName(m.code)) : [];
  return {
    done: result.note ?? countriesSummary(before, codes, countryName).replace(/^Sell in/, "The store sells in"),
    ...(unpriced.length > 0 && { next: `Set the shipping price for ${unpriced.join(", ")} (set_flat_shipping).` }),
    page: adminPage(store, "/settings/countries"),
  };
}

// Languages ------------------------------------------------------------------------------------

async function prepareLanguages(ctx: SetupToolContext, args: LanguagesArgs) {
  const store = await storeNow(ctx);
  const offered = (await listLanguages()).filter((language) => language.enabled);
  const kept = store.localization.keptLocales;
  const resolve = (wanted: string) =>
    resolveLocale(wanted, offered, kept) ?? fail(`${wanted} is not a language stores can offer. They are: ${offered.map((l) => l.lang).join(", ")}.`);
  const main = args.main ? resolve(args.main) : null;
  const others = args.others ? args.others.map(resolve) : null;
  const chosen: Record<string, string> = {};
  for (const [raw, wanted] of Object.entries(args.countries ?? {})) {
    const market = store.markets.find((m) => m.code === raw.toUpperCase()) ?? fail(`The store does not sell to ${raw.toUpperCase()}.`);
    chosen[market.code] = resolve(wanted);
  }
  const several = featureOn(store, "languages");
  let locales: string[];
  let marketLocales: Record<string, string>;
  if (several) {
    locales = languagesOver(store.localization.locales, main, others);
    const langOf = (l: string) => l.split("-")[0];
    marketLocales = {};
    for (const [code, wanted] of Object.entries(chosen)) {
      const own = locales.find((l) => langOf(l) === langOf(wanted));
      if (!own) return fail(`${languageName(wanted)} is not one of the store's languages: add it to the others first.`);
      marketLocales[code] = own;
    }
  } else {
    if (others && others.length > 0) {
      return fail(`${featureOffText("languages")} The store has its main language and each country's own: switch Several languages on first (set_feature).`);
    }
    [locales, marketLocales] = oneLanguageChoice(kept, main ?? store.localization.locales[0] ?? "en", chosen);
  }
  const problems = await languagesProblems(store, locales, marketLocales);
  if (problems.length > 0) return fail(problems.join(" "));
  return { store, locales, marketLocales, shown: several ? locales : locales.slice(0, 1) };
}

/** `set_languages` (owner): the main language, the others and a country's own, saved by D109's `saveLanguages()` as the Languages page does. */
export async function setLanguagesTool(ctx: SetupToolContext, args: LanguagesArgs) {
  const { store, locales, marketLocales, shown } = await prepareLanguages(ctx, args);
  const result = await saveLanguages(member(ctx, store), locales, marketLocales);
  if (!result.ok) return fail(result.problems.join(" "));
  refreshStore(ctx, store);
  return {
    done: `Saved. ${languagesSummary(shown, marketLocales, countryName)}`,
    note: "Texts written in a new language come from the store's translation (Translate, or write_product_texts for a product).",
    page: adminPage(store, "/settings/localization"),
  };
}

// Currencies -----------------------------------------------------------------------------------

async function prepareCurrencies(ctx: SetupToolContext, args: CurrenciesArgs) {
  const store = await storeNow(ctx);
  const natives = new Set(store.keptMarkets.map((m) => m.nativeCurrency));
  const current = [...store.localization.currencies];
  // A country kept but not offered (D178) keeps its currency's rate: its orders' amounts convert with it.
  for (const native of natives) {
    const kept = store.localization.rates.get(native);
    if (kept && !current.some((c) => c.currency === native)) current.push(kept);
  }
  const follow = args.rates_follow_ecb ?? store.ratesAuto;
  const { rows, problems } = currenciesOver(current, args, natives, follow);
  if (problems.length > 0) return fail(problems.join(" "));
  return { store, rows, follow, before: store.localization.currencies.map((c) => c.currency) };
}

/** `set_currencies` (owner, Several currencies on): currencies added, changed or taken away, saved by D109's `saveCurrencies()`. */
export async function setCurrenciesTool(ctx: SetupToolContext, args: CurrenciesArgs) {
  const { store, rows, follow, before } = await prepareCurrencies(ctx, args);
  const result = await saveCurrencies(member(ctx, store), rows, follow);
  if (!result.ok) return fail(result.problems.join(" "));
  refreshStore(ctx, store);
  return { done: `Saved. ${currenciesSummary(before, rows, follow)}`, page: adminPage(store, "/settings/localization") };
}

// Flat-rate shipping ---------------------------------------------------------------------------

async function prepareFlat(ctx: SetupToolContext, args: FlatShippingArgs) {
  const store = await storeNow(ctx);
  const markets = store.markets.map((m) => ({ code: m.code, name: countryName(m.code), currency: m.currency }));
  const { rates, problems } = flatRatesOver(await getShippingSettings(store), args, markets);
  if (problems.length > 0) return fail(problems.join(" "));
  return { store, rates, markets };
}

/** `set_flat_shipping` (`settings:write`): the flat rate per country, the fallback every basket can pay, saved as the Shipping page saves it. */
export async function setFlatShippingTool(ctx: SetupToolContext, args: FlatShippingArgs) {
  const { store, rates, markets } = await prepareFlat(ctx, args);
  const result = await saveShippingSettings(member(ctx, store), rates);
  if (!result.ok) return fail(result.problems.join(" "));
  // Product pages' structured data and llms.txt show the shipping price.
  ctx.invalidate(catalogTag(store.id));
  return { done: `Saved. ${flatShippingSummary(rates, markets, money(store)).replace(/^Charge/, "The store charges")}`, page: adminPage(store, "/settings/shipping") };
}

// Shipping methods -----------------------------------------------------------------------------

async function prepareMethod(ctx: SetupToolContext, args: ShippingMethodArgs) {
  const store = await storeNow(ctx);
  const country = args.country.toUpperCase();
  const market = store.markets.find((m) => m.code === country) ?? fail(`The store does not sell to ${country} (set_countries adds it).`);
  const setup = await getShippingSetup(store.id);
  const inCountry = setup.methods.filter((m) => m.marketCode === country);
  const ref = args.method?.toLowerCase();
  const existing = ref
    ? (inCountry.find((m) => m.id === args.method || m.name.toLowerCase() === ref) ??
      fail(`No shipping method "${args.method}" in ${countryName(country)}. Its methods: ${inCountry.map((m) => m.name).join(", ") || "none yet"}.`))
    : null;
  const currency = existing?.currency ?? market.nativeCurrency;
  const over = methodOver(existing, args, { currency, zones: setup.zones.filter((z) => z.marketCode === country), profiles: setup.profiles });
  if (!over.ok) return fail(over.problem);
  const parsed = methodInput.safeParse(over.input);
  if (!parsed.success) return fail([...new Set(parsed.error.issues.map((issue) => issue.message))].join(" "));
  return { store, market, existing, input: parsed.data, currency };
}

/** `save_shipping_method` (`settings:write`): a method of a country made or changed, every rate block of it, through `saveShippingMethod()`. */
export async function saveShippingMethodTool(ctx: SetupToolContext, args: ShippingMethodArgs) {
  const { store, market, existing, input, currency } = await prepareMethod(ctx, args);
  const saved = await saveShippingMethod(ctx.account.id, store.id, input);
  if (!saved.ok) return fail(saved.message);
  ctx.invalidate(catalogTag(store.id));
  return {
    done: `Saved. ${methodSummary(!existing, input, countryName(market.code), currency, money(store)).replace(/^(Make|Change)/, "The store has")}`,
    method: saved.id,
    page: adminPage(store, `/settings/shipping/methods/${saved.id}`),
  };
}

// Setup status and opening ---------------------------------------------------------------------

/** `setup_progress` (owner): what is done and what is left, in order, with the tool for each step or the one thing only the owner can do. */
export async function setupProgressTool(ctx: SetupToolContext) {
  const store = (await currentStore(ctx.store.slug)) ?? ctx.store;
  const selling = featureOn(store, "shop");
  const [progress, domains, carriers] = await Promise.all([getSetupProgress(store), listStoreDomains(store.id), listCarriers(store.id)]);
  return {
    status: store.status,
    website: !selling,
    ...setupStatus(
      {
        done: progress,
        open: Boolean(store.setupCompletedAt),
        selling,
        booked: stepApplies("bookings", store),
        pendingDomains: domains.filter((d) => d.status === "pending").map((d) => d.hostname),
        carriers: carriers.filter((c) => c.complete).length,
      },
      (page) => adminPage(store, page),
    ),
    ...(selling && { products: { own: progress.counts.ownProducts, demo: progress.counts.demoProducts } }),
  };
}

async function prepareOpen(ctx: SetupToolContext) {
  const store = await storeNow(ctx);
  if (store.setupCompletedAt) return fail("The store is already open.");
  if (store.starter || store.isTemplate) return fail("A demo store is never opened: it is where new stores start from.");
  const progress = await getSetupProgress(store);
  if (!progress.readyToOpen) {
    const missing = [!progress.details && "its business details (set_store_details)", !progress.countries && "a country to sell in (set_countries)"].filter(Boolean);
    return fail(`The store cannot open yet: it needs ${missing.join(" and ")}.`);
  }
  return { store, progress };
}

/** `open_store` (owner, always waits for a yes): the wizard's Open your store, through `completeSetup()`. */
export async function openStoreTool(ctx: SetupToolContext) {
  const { store } = await prepareOpen(ctx);
  const result = await completeSetup(member(ctx, store));
  if (!result.ok) return fail(result.problems.join(" "));
  afterAnswer(() => chargeDueThemePurchases({ storeId: store.id }));
  refreshStore(ctx, store);
  const selling = featureOn(store, "shop");
  return {
    done: `${store.name} is open.`,
    ...(selling && !store.paymentsOn && { note: "Shoppers cannot pay until payments are switched on: setup_progress says what the owner does on the Payments page." }),
  };
}

// Checks and words before a yes ----------------------------------------------------------------

/** The setup tools' checks before a call is kept for the owner's yes: what would be refused is refused now. */
export async function preflightSetupTool(ctx: SetupToolContext, name: string, input: unknown): Promise<void> {
  if (name === "set_store_details") await prepareDetails(ctx, input as StoreDetailsArgs);
  else if (name === "set_countries") await prepareCountries(ctx, input as { countries: string[] });
  else if (name === "set_languages") await prepareLanguages(ctx, input as LanguagesArgs);
  else if (name === "set_currencies") await prepareCurrencies(ctx, input as CurrenciesArgs);
  else if (name === "set_flat_shipping") await prepareFlat(ctx, input as FlatShippingArgs);
  else if (name === "save_shipping_method") await prepareMethod(ctx, input as ShippingMethodArgs);
  else if (name === "open_store") await prepareOpen(ctx);
}

/** What an approval of a setup tool says, from the store as it is; null when the call could not be read (the generic words stand). */
export async function setupApprovalWords(ctx: SetupToolContext, name: string, input: Record<string, unknown>): Promise<string | null> {
  try {
    if (name === "set_store_details") {
      const { now, input: next } = await prepareDetails(ctx, input as StoreDetailsArgs);
      return detailsSummary(now, next);
    }
    if (name === "set_countries") {
      const { codes, before } = await prepareCountries(ctx, input as { countries: string[] });
      return countriesSummary(before, codes, countryName);
    }
    if (name === "set_languages") {
      const { shown, marketLocales } = await prepareLanguages(ctx, input as LanguagesArgs);
      return languagesSummary(shown, marketLocales, countryName);
    }
    if (name === "set_currencies") {
      const { rows, follow, before } = await prepareCurrencies(ctx, input as CurrenciesArgs);
      return currenciesSummary(before, rows, follow);
    }
    if (name === "set_flat_shipping") {
      const { store, rates, markets } = await prepareFlat(ctx, input as FlatShippingArgs);
      return flatShippingSummary(rates, markets, money(store));
    }
    if (name === "save_shipping_method") {
      const { store, market, existing, input: method, currency } = await prepareMethod(ctx, input as ShippingMethodArgs);
      return methodSummary(!existing, method, countryName(market.code), currency, money(store));
    }
    if (name === "open_store") {
      const { store } = await prepareOpen(ctx);
      return openSummary(store.name, { selling: featureOn(store, "shop"), paymentsOn: store.paymentsOn });
    }
  } catch {
    return null;
  }
  return null;
}
