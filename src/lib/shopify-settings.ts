/**
 * *Copy my shop*, part 2 (D445 step 5b, `docs/moving-from-shopify.md` 4.3 and 5.1), pure: the shop's countries, its shipping rates, its
 * discount codes and its look, read by small ordinary queries (none of them has a bulk read), each turned into one line of what the
 * writer that owns it here takes: `setMarkets()`, `saveShippingSettings()`, `saveDiscount()` (switched off) and the AI manager's
 * `design_look` (a theme in the library, not live). What ours cannot say as Shopify did is left out with its reason, never bent to fit.
 * Nothing here fetches. Shapes read 3 November 2026 at <https://shopify.dev/docs/api/admin-graphql/2026-10>.
 */
import { categoryName } from "./shopify-copy";

type Obj = Record<string, unknown>;

const s = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v) : "");
const o = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const nodes = (v: unknown): Obj[] => {
  const list = o(v).nodes;
  return Array.isArray(list) ? list.map(o) : [];
};
const currency = (v: unknown): string | null => (typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : null);
const country = (v: unknown): string | null => (typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : null);

/** Shopify's decimal amount as a plain decimal text without trailing zeros (`"49.00"` → `"49"`, `"49.50"` → `"49.5"`), at most two decimals, or null. */
export function amountOf(v: unknown): string | null {
  const text = typeof v === "number" ? String(v) : s(v, 40).trim();
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(text)) return null;
  const trimmed = text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  // More than two decimals is a price no currency sold in here has (and `parsePrice()` would read a thousands mark).
  return /\.\d{3,}$/.test(trimmed) ? null : trimmed;
}

// ---------------------------------------------------------------------------
// The queries
// ---------------------------------------------------------------------------

/** The markets and their countries, as the shop's report reads them (`src/server/shopify-report.ts`). */
export const COUNTRIES_QUERY = `query KaizenCopyMarkets { markets(first: 50) { nodes { name regions(first: 250) { nodes { ... on MarketRegionCountry { code } } } currencySettings { baseCurrency { currencyCode } } } } }`;

/** The general shipping profile's zones, their countries and their rates (a few profiles: the general one is marked `default`). */
export const SHIPPING_QUERY = `query KaizenCopyShipping { deliveryProfiles(first: 3) { nodes { default
  profileLocationGroups { locationGroupZones(first: 25) { nodes {
    zone { countries { code { countryCode restOfWorld } } }
    methodDefinitions(first: 10) { nodes { active
      rateProvider { ... on DeliveryRateDefinition { price { amount currencyCode } } }
      methodConditions { field operator conditionCriteria { ... on MoneyV2 { amount currencyCode } } }
    } }
  } } }
} } }`;

const DISCOUNT_FIELDS = `title status startsAt endsAt usageLimit appliesOncePerCustomer
  codes(first: 1) { nodes { code } }
  combinesWith { productDiscounts orderDiscounts shippingDiscounts }
  context { __typename }
  minimumRequirement { __typename
    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }`;

/** One page of the shop's discount codes (25 a page; the server follows `endCursor`). */
export const DISCOUNTS_QUERY = `query KaizenCopyDiscounts($after: String) { codeDiscountNodes(first: 25, after: $after) {
  pageInfo { hasNextPage endCursor }
  nodes { codeDiscount { __typename
    ... on DiscountCodeBasic { ${DISCOUNT_FIELDS}
      customerGets {
        value { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem } }
        items { __typename ... on DiscountProducts { products(first: 10) { nodes { handle } } productVariants(first: 1) { nodes { id } } } ... on DiscountCollections { collections(first: 5) { nodes { title } } } }
      } }
    ... on DiscountCodeFreeShipping { ${DISCOUNT_FIELDS} maximumShippingPrice { amount } }
  } }
} }`;

/** How many pages of codes one copy reads (25 each): more is said, never silently cut. */
export const DISCOUNT_PAGES_MAX = 20;

/** The live theme's settings file, where its colours, fonts and logo are. */
export const LOOK_QUERY = `query KaizenCopyLook { themes(first: 1, roles: [MAIN]) { nodes { name files(filenames: ["config/settings_data.json"], first: 1) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } } } }`;

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

export type CountryLine = { code: string; currency: string | null };

/** Every country a market of the shop sells to, once each, with that market's currency. */
export function countriesOf(data: unknown): CountryLine[] {
  const seen = new Map<string, CountryLine>();
  for (const market of nodes(o(data).markets)) {
    const cur = currency(o(o(market.currencySettings).baseCurrency).currencyCode);
    for (const region of nodes(market.regions)) {
      const code = country(region.code);
      if (code && !seen.has(code)) seen.set(code, { code, currency: cur });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

/** A country's flat rate as Shopify's general profile gives it: the cheapest paid rate, and the basket value above which it is free. */
export type ShippingLine = { country: string; currency: string; amount: string; freeOver: string | null };

const minor = (amount: string): number => Math.round(Number(amount) * 100);

/**
 * Shopify's rates per country, ours being one flat rate per country (and free above a value): the cheapest active rate without a condition,
 * and the lowest "at least this much" a free rate asks for. A country whose rates all hang on weight or a carrier's own price is left out
 * (ours cannot say it); rest of world is left out (a country here is named).
 */
export function shippingOf(data: unknown): ShippingLine[] {
  const profiles = nodes(o(data).deliveryProfiles);
  const general = profiles.find((p) => p.default === true) ?? profiles[0];
  if (!general) return [];
  const out = new Map<string, ShippingLine>();
  const groups = Array.isArray(general.profileLocationGroups) ? general.profileLocationGroups.map(o) : [];
  for (const group of groups) {
    for (const zone of nodes(group.locationGroupZones)) {
      let flat: { amount: string; currency: string } | null = null;
      let freeOver: string | null = null;
      for (const method of nodes(zone.methodDefinitions)) {
        if (method.active === false) continue;
        const price = o(o(method.rateProvider).price);
        const amount = amountOf(price.amount);
        const cur = currency(price.currencyCode);
        if (amount === null || cur === null) continue; // a carrier's own price: ours has no counterpart
        const conditions = Array.isArray(method.methodConditions) ? method.methodConditions.map(o) : [];
        if (conditions.some((c) => s(c.field) !== "TOTAL_PRICE")) continue; // by weight
        const atLeast = conditions.find((c) => s(c.operator) === "GREATER_THAN_OR_EQUAL_TO");
        const atMost = conditions.find((c) => s(c.operator) === "LESS_THAN_OR_EQUAL_TO");
        if (minor(amount) === 0 && atLeast && !atMost) {
          const over = amountOf(o(atLeast.conditionCriteria).amount);
          if (over !== null && (freeOver === null || minor(over) < minor(freeOver))) freeOver = over;
          continue;
        }
        if (conditions.length > 0) continue; // a rate for part of the baskets only
        if (flat === null || minor(amount) < minor(flat.amount)) flat = { amount, currency: cur };
      }
      if (!flat) continue;
      for (const c of Array.isArray(o(zone.zone).countries) ? (o(zone.zone).countries as unknown[]).map(o) : []) {
        const code = o(c.code);
        const cc = country(code.countryCode);
        if (code.restOfWorld === true || !cc || out.has(cc)) continue;
        out.set(cc, { country: cc, currency: flat.currency, amount: flat.amount, freeOver: freeOver !== null && minor(freeOver) > 0 ? freeOver : null });
      }
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Discount codes
// ---------------------------------------------------------------------------

/** Why a code is not brought over: ours cannot say what Shopify's does, so it is listed for the owner rather than changed. */
export type DiscountLeftOut = "other_kind" | "some_customers" | "each_item" | "variants" | "not_whole_percent" | "max_shipping" | "expired" | "no_code";

/** A Shopify code as one line: everything ours needs, the products by handle and the collections by their category's name here. */
export type DiscountLine = {
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  percent: number | null;
  amount: { amount: string; currency: string } | null;
  minSubtotal: { amount: string; currency: string } | null;
  minQuantity: number | null;
  productHandles: string[] | null;
  categoryNames: string[];
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  oncePerCustomer: boolean;
  combinesWith: ("products" | "order" | "shipping")[];
};

const isoOf = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** One code discount node as a line, or why it stays behind. */
export function discountOf(node: unknown): DiscountLine | { leftOut: DiscountLeftOut; code: string } {
  const d = o(o(node).codeDiscount);
  const type = s(d.__typename, 60);
  const code = s(nodes(d.codes)[0]?.code, 255).trim();
  if (type !== "DiscountCodeBasic" && type !== "DiscountCodeFreeShipping") return { leftOut: "other_kind", code };
  if (code === "") return { leftOut: "no_code", code };
  if (s(d.status) === "EXPIRED") return { leftOut: "expired", code };
  if (s(o(d.context).__typename) !== "DiscountBuyerSelectionAll") return { leftOut: "some_customers", code };
  const req = o(d.minimumRequirement);
  const sub = o(req.greaterThanOrEqualToSubtotal);
  const minSubtotal = s(req.__typename) === "DiscountMinimumSubtotal" && amountOf(sub.amount) && currency(sub.currencyCode) ? { amount: amountOf(sub.amount)!, currency: currency(sub.currencyCode)! } : null;
  const qty = Number(req.greaterThanOrEqualToQuantity);
  const minQuantity = s(req.__typename) === "DiscountMinimumQuantity" && Number.isInteger(qty) && qty >= 1 ? Math.min(qty, 1000) : null;
  const usage = Number(d.usageLimit);
  const combines = o(d.combinesWith);
  const base = {
    code,
    minSubtotal,
    minQuantity,
    startsAt: isoOf(d.startsAt),
    endsAt: isoOf(d.endsAt),
    usageLimit: d.usageLimit != null && Number.isInteger(usage) && usage >= 1 ? Math.min(usage, 1_000_000) : null,
    oncePerCustomer: d.appliesOncePerCustomer === true,
    combinesWith: [...(combines.productDiscounts === true ? ["products" as const] : []), ...(combines.orderDiscounts === true ? ["order" as const] : []), ...(combines.shippingDiscounts === true ? ["shipping" as const] : [])],
  };
  if (type === "DiscountCodeFreeShipping") {
    if (d.maximumShippingPrice && amountOf(o(d.maximumShippingPrice).amount) !== null) return { leftOut: "max_shipping", code };
    return { ...base, kind: "free_shipping", percent: null, amount: null, productHandles: null, categoryNames: [] };
  }
  const gets = o(d.customerGets);
  const value = o(gets.value);
  const items = o(gets.items);
  let productHandles: string[] | null = null;
  let categoryNames: string[] = [];
  if (s(items.__typename) === "DiscountProducts") {
    if (nodes(items.productVariants).length > 0) return { leftOut: "variants", code };
    productHandles = nodes(items.products).map((p) => s(p.handle, 255).toLowerCase()).filter(Boolean);
    if (productHandles.length === 0) return { leftOut: "variants", code };
  } else if (s(items.__typename) === "DiscountCollections") {
    categoryNames = nodes(items.collections).map((c) => categoryName(s(c.title, 255))).filter(Boolean);
    if (categoryNames.length === 0) return { leftOut: "other_kind", code };
    productHandles = [];
  } else if (s(items.__typename) !== "AllDiscountItems") return { leftOut: "other_kind", code };
  if (s(value.__typename) === "DiscountPercentage") {
    const percent = Number(value.percentage) * 100;
    const whole = Math.round(percent);
    if (!Number.isFinite(percent) || Math.abs(percent - whole) > 1e-6 || whole < 1 || whole > 100) return { leftOut: "not_whole_percent", code };
    return { ...base, kind: "percent", percent: whole, amount: null, productHandles, categoryNames };
  }
  if (s(value.__typename) === "DiscountAmount") {
    if (value.appliesOnEachItem === true) return { leftOut: "each_item", code };
    const money = o(value.amount);
    const amount = amountOf(money.amount);
    const cur = currency(money.currencyCode);
    if (!amount || !cur) return { leftOut: "other_kind", code };
    return { ...base, kind: "fixed", percent: null, amount: { amount, currency: cur }, productHandles, categoryNames };
  }
  return { leftOut: "other_kind", code };
}

/** What `saveDiscount()` takes for a line, switched off until the move, in the countries whose currency is the code's. */
export function discountInputOf(
  line: DiscountLine,
  markets: readonly { code: string; currency: string }[],
  productIds: readonly string[] | null,
  termIds: readonly string[],
): Record<string, unknown> | null {
  const inCurrency = (money: { amount: string; currency: string } | null): Record<string, string> =>
    money ? Object.fromEntries(markets.filter((m) => m.currency === money.currency).map((m) => [m.code, money.amount])) : {};
  const amounts = inCurrency(line.amount);
  const minSubtotals = inCurrency(line.minSubtotal);
  // An amount, or a minimum, in a currency the store sells in nowhere cannot be said here.
  if (line.kind === "fixed" && Object.keys(amounts).length === 0) return null;
  if (line.minSubtotal && Object.keys(minSubtotals).length === 0) return null;
  return {
    code: line.code,
    kind: line.kind,
    percent: line.percent ?? 10,
    amounts,
    minSubtotals,
    // As the editor sends it: the products named, or none (null) for everything or for categories alone.
    productIds: productIds && productIds.length > 0 ? [...productIds] : null,
    termIds: [...termIds],
    minQuantity: line.minQuantity,
    startsAt: line.startsAt,
    endsAt: line.endsAt,
    usageLimit: line.usageLimit,
    oncePerCustomer: line.oncePerCustomer,
    combinesWith: line.combinesWith,
    active: false,
  };
}

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------

/** A Shopify font handle (`playfair_display_n4`) as its family's name (`Playfair Display`), for the font catalogue to find or not. */
export function fontFamilyOf(handle: unknown): string | null {
  const parts = s(handle, 80).trim().toLowerCase().split("_").filter(Boolean);
  if (parts.length < 2 || !/^[ni]\d$/.test(parts[parts.length - 1]!)) return null;
  return parts
    .slice(0, -1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A colour as `#rrggbb`, from Shopify's `#rgb`, `#rrggbb` or `rgb(…)`; null for a gradient, a transparent one or anything else. */
export function hexOf(v: unknown): string | null {
  const text = s(v, 60).trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(1|1\.0+|0?\.\d+|0)\s*)?\)$/.exec(text);
  if (rgb && (rgb[4] === undefined || Number(rgb[4]) === 1) && [rgb[1], rgb[2], rgb[3]].every((n) => Number(n) <= 255))
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

/** The look as one line: the theme's name, its colours and its fonts' families as Shopify names them. */
export type LookLine = { name: string; accent: string; background: string | null; text: string | null; headingFont: string | null; bodyFont: string | null };

const firstHex = (settings: Obj, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const hex = hexOf(settings[key]);
    if (hex) return hex;
  }
  return null;
};

/**
 * The live theme's look from its `config/settings_data.json` (a comment may head it): the first colour scheme's button, background and
 * text (Shopify's own themes since 2023), else the older settings' names; the heading and body fonts. Null without an accent.
 */
export function lookOf(themeName: string, content: string): LookLine | null {
  let data: Obj;
  try {
    data = o(JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")));
  } catch {
    return null;
  }
  const raw = data.current;
  const current = typeof raw === "string" ? o(o(data.presets)[raw]) : o(raw);
  const schemes = o(current.color_schemes);
  const first = o(o(schemes["scheme-1"] ?? Object.values(schemes)[0]).settings);
  // Dawn and its kin name the button's colour `button`; Horizon (Shopify's default since 2025) `primary_button_background` and `primary`.
  const accent = firstHex(first, ["button", "primary_button_background", "primary"]) ?? firstHex(current, ["colors_accent_1", "color_accent", "colors_accent", "color_button", "color_primary", "colors_solid_button_labels"]);
  if (!accent) return null;
  return {
    name: s(themeName, 50).trim() || "Shopify",
    accent,
    background: firstHex(first, ["background"]) ?? firstHex(current, ["colors_background_1", "color_body_bg", "color_background", "colors_background"]),
    text: firstHex(first, ["text", "foreground"]) ?? firstHex(current, ["colors_text", "color_body_text", "color_text", "colors_body_text"]),
    headingFont: fontFamilyOf(current.type_header_font ?? current.type_heading_font ?? current.heading_font ?? current.type_font_heading),
    bodyFont: fontFamilyOf(current.type_body_font ?? current.body_font ?? current.type_font_body),
  };
}

/** The names (never the values) of a theme's settings and its first colour scheme's, for the log when its look could not be read. */
export function lookKeysOf(data: unknown): { theme: string; settings: string[]; scheme: string[] } | null {
  const theme = nodes(o(data).themes)[0];
  if (!theme) return null;
  let parsed: Obj;
  try {
    parsed = o(JSON.parse(s(o(nodes(theme.files)[0]?.body).content, 2_000_000).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")));
  } catch {
    return { theme: s(theme.name, 50), settings: [], scheme: [] };
  }
  const raw = parsed.current;
  const current = typeof raw === "string" ? o(o(parsed.presets)[raw]) : o(raw);
  const schemes = o(current.color_schemes);
  const first = o(o(schemes["scheme-1"] ?? Object.values(schemes)[0]).settings);
  const names = (x: Obj) => Object.keys(x).filter((k) => /^[a-z0-9_-]{1,60}$/i.test(k)).slice(0, 80);
  return { theme: s(theme.name, 50), settings: names(current), scheme: names(first) };
}

/** The look's line from the theme query's answer, or null. */
export function lookFromAnswer(data: unknown): LookLine | null {
  const theme = nodes(o(data).themes)[0];
  if (!theme) return null;
  const content = s(o(nodes(theme.files)[0]?.body).content, 2_000_000);
  return content ? lookOf(s(theme.name, 50), content) : null;
}

// ---------------------------------------------------------------------------
// Gift cards (D445 step 8, `docs/moving-from-shopify.md` 6.4)
// ---------------------------------------------------------------------------

/** One page of the shop's live gift cards (100 a page; the server follows `endCursor`). Shopify never gives a card's full code. */
export const GIFT_CARDS_QUERY = `query KaizenCopyGiftCards($after: String) { giftCards(first: 100, after: $after, query: "status:enabled") {
  pageInfo { hasNextPage endCursor }
  nodes { id lastCharacters enabled expiresOn balance { amount currencyCode } customer { defaultEmailAddress { emailAddress } } }
} }`;

/** How many pages of cards one read takes (100 each): more is logged, never silently cut. */
export const GIFT_CARD_PAGES_MAX = 50;

/** A Shopify gift card with money left, as one line: its id there, the last characters people see, the balance, expiry and holder. */
export type GiftCardLine = { id: string; last4: string; amount: string; currency: string; expiresOn: string | null; email: string | null };

/** A card node as a line, or null when it has nothing left, is switched off or has expired. */
export function giftCardOf(node: unknown, today: string): GiftCardLine | null {
  const n = o(node);
  const id = s(n.id, 200);
  const money = o(n.balance);
  const amount = amountOf(money.amount);
  const cur = currency(money.currencyCode);
  const expiresOn = typeof n.expiresOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(n.expiresOn) ? n.expiresOn : null;
  if (!/^gid:\/\/shopify\/GiftCard\/\d+$/.test(id) || n.enabled === false || !amount || !cur || Number(amount) <= 0) return null;
  if (expiresOn && expiresOn < today) return null;
  const email = s(o(o(n.customer).defaultEmailAddress).emailAddress, 254).trim().toLowerCase();
  return { id, last4: s(n.lastCharacters, 8).toUpperCase().slice(-4), amount, currency: cur, expiresOn, email: email.includes("@") ? email : null };
}
