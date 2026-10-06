import { CHANNELS, isChannel, type Channel } from "./analytics-channels";
import { safeRatio } from "./analytics-core";
import { splitSiteVersions } from "./ab-site";
import { parseMarketSlug } from "./market-slug";

/**
 * Where visits come from and what becomes of them (D152, docs/analytics.md,
 * "Visit counting", "Marketing", "Traffic"): the channel of a visit, what a
 * landing page is, the funnel from a visit to a purchase, and the channel table
 * with its cost figures. Pure, and never throws on what a browser sends: a
 * referrer or a tag that cannot be understood is "direct" or "other", never an error.
 *
 * Device class is `deviceOf()` and bots are `isBot()`, both in `experiments.ts`;
 * the visitor hash is `visit-hash.ts`.
 */

// ---------------------------------------------------------------------------
// Hosts and sources
// ---------------------------------------------------------------------------

const VALID_HOST = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

/**
 * A host as it is compared: lower case, punycode for international names, no port, path, user or trailing dot, and
 * without a leading `www.` or `m.` (so `m.facebook.com` and `facebook.com` are one). Takes a bare host or a whole
 * address. Anything that is not a host (not a string, spaces, an IPv6 literal, too long) is the empty string.
 */
export function normalizeHost(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (text === "" || text.length > 300 || /\s/.test(text)) return "";
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`).hostname;
  } catch {
    return "";
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (!VALID_HOST.test(host) || host.includes("..")) return "";
  // Only strip a prefix while a real name is left: `m.com` stays `m.com`.
  for (;;) {
    const stripped = host.replace(/^(?:www|m)\./, "");
    if (stripped === host || !stripped.includes(".")) break;
    host = stripped;
  }
  return host;
}

/** `host` is `domain` or a subdomain of it. */
const under = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

type HostKind = "search" | "social" | "email";
type KnownHost = { label: string; kind: HostKind; test: (host: string) => boolean };

const is = (...domains: string[]) => (host: string) => domains.some((d) => under(host, d));

/**
 * Hosts we know the meaning of. Order matters where one could match two: mail hosts come first so that
 * `mail.yahoo.com` is mail and not Yahoo search. Labels are what the Marketing page shows as the source.
 * Search engines are listed by domain; Google and Yahoo have many country domains and many products, so only their
 * search addresses count (`google.no`, `images.google.com`, `search.yahoo.com`, not `docs.google.com` or `mail.yahoo.com`).
 */
const KNOWN_HOSTS: readonly KnownHost[] = [
  // Mail
  { label: "gmail", kind: "email", test: (h) => h === "mail.google.com" || h === "com.google.android.gm" },
  { label: "outlook", kind: "email", test: is("outlook.live.com", "outlook.office.com", "outlook.office365.com", "outlook.com") },
  { label: "yahoo mail", kind: "email", test: (h) => h === "mail.yahoo.com" },
  // Search
  { label: "google", kind: "search", test: (h) => /^(?:images\.)?google\.(?:com?\.)?[a-z]{2,3}$/.test(h) || h === "com.google.android.googlequicksearchbox" },
  { label: "bing", kind: "search", test: is("bing.com") },
  { label: "duckduckgo", kind: "search", test: is("duckduckgo.com") },
  { label: "ecosia", kind: "search", test: is("ecosia.org") },
  { label: "yahoo", kind: "search", test: (h) => /^(?:[a-z]{2}\.)?(?:search\.)?yahoo\.(?:com|co\.[a-z]{2}|[a-z]{2})$/.test(h) && h !== "mail.yahoo.com" },
  { label: "yandex", kind: "search", test: (h) => /^(?:yandex\.[a-z]{2,3}(?:\.[a-z]{2})?|ya\.ru)$/.test(h) },
  { label: "startpage", kind: "search", test: is("startpage.com") },
  { label: "brave", kind: "search", test: (h) => h === "search.brave.com" },
  { label: "kagi", kind: "search", test: is("kagi.com") },
  { label: "qwant", kind: "search", test: is("qwant.com") },
  { label: "baidu", kind: "search", test: is("baidu.com") },
  { label: "seznam", kind: "search", test: is("seznam.cz") },
  { label: "ask", kind: "search", test: (h) => h === "ask.com" },
  // Social
  { label: "facebook", kind: "social", test: (h) => is("facebook.com", "fb.com", "fb.me", "messenger.com")(h) || h === "com.facebook.katana" || h === "com.facebook.orca" },
  { label: "instagram", kind: "social", test: (h) => is("instagram.com")(h) || h === "com.instagram.android" },
  { label: "twitter", kind: "social", test: (h) => is("t.co", "twitter.com", "x.com")(h) || h === "com.twitter.android" },
  { label: "linkedin", kind: "social", test: (h) => is("linkedin.com", "lnkd.in")(h) || h === "com.linkedin.android" },
  { label: "tiktok", kind: "social", test: (h) => is("tiktok.com")(h) || h === "com.zhiliaoapp.musically" },
  { label: "pinterest", kind: "social", test: (h) => /(?:^|\.)pinterest\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(h) || under(h, "pin.it") || h === "com.pinterest" },
  { label: "youtube", kind: "social", test: (h) => is("youtube.com", "youtu.be")(h) || h === "com.google.android.youtube" },
  { label: "reddit", kind: "social", test: (h) => is("reddit.com", "redd.it")(h) || h === "com.reddit.frontpage" },
  { label: "snapchat", kind: "social", test: is("snapchat.com") },
  { label: "threads", kind: "social", test: is("threads.net") },
  { label: "bluesky", kind: "social", test: is("bsky.app") },
];

/** What a normalised host is, when we know it. */
export function knownHost(host: string): { label: string; kind: HostKind } | null {
  const found = host ? KNOWN_HOSTS.find((k) => k.test(host)) : undefined;
  return found ? { label: found.label, kind: found.kind } : null;
}

/** Names a `utm_source` is written as, and the label they get: what an owner types is not always the platform's name. */
const SOURCE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["fb", "facebook"],
  ["ig", "instagram"],
  ["insta", "instagram"],
  ["yt", "youtube"],
  ["tw", "twitter"],
  ["x", "twitter"],
  ["li", "linkedin"],
  ["e-mail", "email"],
  ["mail", "email"],
]);

/** Source names (after aliasing) that tell what kind of source a tag with no medium is. */
// A Map, never an object: a visitor chooses the text looked up, and `constructor` or `__proto__` must find nothing.
const SOURCE_KINDS: ReadonlyMap<string, HostKind> = new Map<string, HostKind>([
  ...KNOWN_HOSTS.filter((k) => k.kind !== "email").map((k): [string, HostKind] => [k.label, k.kind]),
  ...["email", "newsletter", "gmail", "outlook", "mailchimp", "klaviyo", "brevo", "sendinblue", "mailerlite", "omnisend"].map((k): [string, HostKind] => [k, "email"]),
]);

/**
 * A `utm_source` (or any source) as it is kept and shown: lower case, one space between words, no control or markup
 * characters, at most 40 characters, a host written as a name (`l.facebook.com` and `fb` are `facebook`). Anything
 * that is not text is the empty string.
 */
export function cleanSource(raw: unknown): string {
  const text = tidy(raw, 40);
  if (text === "") return "";
  if (text.includes(".") && !text.includes(" ")) {
    const host = normalizeHost(text);
    if (host) return knownHost(host)?.label ?? host;
  }
  return SOURCE_ALIASES.get(text) ?? text;
}

/** A `utm_campaign` as it is kept: tidied as a source is, lower case so `Spring` and `spring` are one, at most 80 characters. */
export function cleanCampaign(raw: unknown): string {
  return tidy(raw, 80);
}

function tidy(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const text = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>"'`\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return text.length > max ? text.slice(0, max).trim() : text;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type ClassifyInput = {
  /** The host of the page that linked here (`document.referrer`'s host, or the whole address); empty for none. */
  referrerHost?: string | null;
  /** The store's own hosts (its address on the platform and its domains): a visit coming from one is not a new source. */
  ownHosts: readonly string[];
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  /** Which ad click ids were in the address: only their presence is read, never their value. */
  clickIds?: { gclid?: boolean; fbclid?: boolean; ttclid?: boolean };
};

export type Classified = {
  channel: Channel;
  /** A short readable name: `google`, `facebook`, `newsletter`, a referring host, or empty. */
  source: string;
  /** The tidied `utm_campaign`, or empty. */
  campaign: string;
};

// `utm_medium` as written by owners and platforms, with everything but letters and digits taken out and lower case
// (`paid-social`, `Paid Social` and `paid_social` are all `paidsocial`).
const MEDIUM_PAID_SOCIAL = new Set(["paidsocial", "socialpaid", "paidsocialmedia", "paidsm"]);
/** Paid when the source is a social network (the usual Facebook and Instagram ad tagging: `cpc` and `facebook`), paid search otherwise. */
const MEDIUM_PAID = new Set(["cpc", "ppc", "paid", "paidsearch", "searchpaid", "sem", "paidmedia"]);
/** Paid on a social source; anywhere else display advertising, which is none of our channels. */
const MEDIUM_PAID_IMPRESSIONS = new Set(["cpm", "cpv"]);
const MEDIUM_EMAIL = new Set(["email", "newsletter", "mail", "emailmarketing", "edm"]);
const MEDIUM_AFFILIATE = new Set(["affiliate", "affiliates", "partner", "partners"]);
const MEDIUM_SOCIAL = new Set(["social", "socialmedia", "organicsocial", "sm", "socialnetwork"]);
const MEDIUM_NONE = new Set(["", "none", "notset", "null", "undefined"]);

const mediumKey = (raw: unknown): string => (typeof raw === "string" ? raw.toLowerCase().replace(/[^a-z0-9]/g, "") : "");

/**
 * The channel, source and campaign of a visit, decided once on its first page view. The rules, in order; the first
 * that applies wins:
 *
 * 1. `utm_medium` says it: `paidsocial`/`social-paid` is paid social; `cpc`, `ppc`, `paid`, `paidsearch`, `sem` is paid
 *    search, or paid social when the source is a social network (that is how Facebook and Instagram ads are tagged),
 *    and `cpm`/`cpv` is paid social on a social source and `other` anywhere else; `email`, `newsletter` is email;
 *    `affiliate`, `partner` is affiliate; `social` is organic social; `organic` is organic search (organic social
 *    on a social source); `referral` is referral.
 * 2. An ad click id: `gclid` is paid search, `ttclid` paid social. (`fbclid` is not: Facebook adds it to every link
 *    followed from its pages, ads or not.)
 * 3. Any other `utm_medium` is `other`: the owner tagged it, we cannot say what it is, and the referrer is not asked.
 * 4. A `utm_source` with no medium: a search engine's name is organic search, a social network's organic social, a mail
 *    tool's or `newsletter` email; any other name is `other`.
 * 5. The referrer: none, our own host or something that is not a host is direct (with `fbclid` and no referrer,
 *    organic social: in-app browsers hide the referrer); a mail host is email; a search engine is organic search; a
 *    social network is organic social; any other host is referral.
 *
 * The source is the cleaned `utm_source` when there is one, else the name of the referrer (`google`, `facebook`, a
 * referral's host), else the platform of the click id, else empty.
 */
export function classifyChannel(input: ClassifyInput): Classified {
  const campaign = cleanCampaign(input.utmCampaign);
  const tagged = cleanSource(input.utmSource);
  const referrer = normalizeHost(input.referrerHost);
  const own = (input.ownHosts ?? []).map(normalizeHost).filter((h) => h !== "");
  const fromOwn = referrer !== "" && own.some((o) => under(referrer, o));
  const referrerKnown = referrer !== "" && !fromOwn ? knownHost(referrer) : null;
  const referrerLabel = fromOwn ? "" : referrerKnown?.label ?? referrer;
  const medium = mediumKey(input.utmMedium);
  const clicks = input.clickIds ?? {};
  const taggedKind = tagged ? SOURCE_KINDS.get(tagged) : undefined;
  const social = taggedKind === "social" || (tagged === "" && referrerKnown?.kind === "social");

  const done = (channel: Channel, fallbackSource = ""): Classified => ({ channel, source: tagged || referrerLabel || fallbackSource, campaign });

  if (MEDIUM_PAID_SOCIAL.has(medium)) return done("paid_social");
  if (MEDIUM_PAID.has(medium)) return done(social ? "paid_social" : "paid_search", clicks.gclid ? "google" : "");
  if (MEDIUM_PAID_IMPRESSIONS.has(medium)) return done(social ? "paid_social" : "other");
  if (MEDIUM_EMAIL.has(medium)) return done("email");
  if (MEDIUM_AFFILIATE.has(medium)) return done("affiliate");
  if (MEDIUM_SOCIAL.has(medium)) return done("organic_social");
  if (medium === "organic") return done(social ? "organic_social" : "organic_search");
  if (medium === "referral") return done("referral");

  if (clicks.gclid) return done("paid_search", "google");
  if (clicks.ttclid) return done("paid_social", "tiktok");

  if (!MEDIUM_NONE.has(medium)) return done("other");

  if (tagged) {
    if (taggedKind === "search") return done("organic_search");
    if (taggedKind === "social") return done("organic_social");
    if (taggedKind === "email") return done("email");
    return done("other");
  }

  if (referrer === "" || fromOwn) return clicks.fbclid && referrer === "" ? done("organic_social", "facebook") : done("direct");
  if (referrerKnown?.kind === "email") return done("email");
  if (referrerKnown?.kind === "search") return done("organic_search");
  if (referrerKnown?.kind === "social") return done("organic_social");
  return done("referral");
}

/** The channel names (and `unknown`, for orders with no visit) as the admin shows them. */
export const UNKNOWN_CHANNEL = "unknown";
/**
 * Orders staff made from a draft order (D173, `orders.source = 'draft'`): not a visit, so no channel earns them and they have no sessions, no
 * conversion and no spend. They are a row of their own in the channel table so its revenue adds up to the period's, and the blended conversion leaves them out.
 */
export const STAFF_CHANNEL = "staff";
/** Rows that are not a place visitors come from: their sessions are not known and they are never a channel to compare or spend on. */
export const isNotAChannel = (key: string): boolean => key === UNKNOWN_CHANNEL || key === STAFF_CHANNEL;
export const channelLabel = (key: string): string =>
  key === UNKNOWN_CHANNEL ? "Unknown" : key === STAFF_CHANNEL ? "Staff-made" : key === "blended" ? "Blended" : (CHANNELS.find((c) => c.key === key)?.label ?? key);

// ---------------------------------------------------------------------------
// Landing pages
// ---------------------------------------------------------------------------

export type LandingKind = "product" | "checkout" | "cart" | "order" | "other";

export type Landing = {
  kind: LandingKind;
  /** The product's handle for `product`, as it is in the address (decoded); null otherwise. */
  handle: string | null;
};

const NOT_LANDING: Landing = { kind: "other", handle: null };

/**
 * What a visit's first page was, from its path. A store's pages are `/s/{store}/{market}/…` on the platform and
 * `/{market}/…` on a store's own host, and the market may carry A/B versions (`no~3fa9c1d2b`, `splitSiteVersions()`):
 * `/{market}/p/{handle}` is a product, `/cart` the cart, `/checkout` the checkout, `/order/{id}` an order page.
 * Everything else, a path that is not a store page, or one with no real market, is `other`. A query or fragment is ignored.
 */
export function landingKind(path: unknown): Landing {
  if (typeof path !== "string") return NOT_LANDING;
  const clean = path.split(/[?#]/, 1)[0];
  let segments = clean.split("/").filter((s) => s !== "");
  // `s` is not a market (those are two letters), so it only ever means "a store on the platform".
  if (segments[0] === "s") segments = segments.slice(2);
  if (segments.length === 0) return NOT_LANDING;
  const market = splitSiteVersions(segments[0].toLowerCase()).market;
  if (!parseMarketSlug(market)) return NOT_LANDING;
  const [, place, rest] = segments;
  switch (place) {
    case "p": {
      if (rest === undefined) return NOT_LANDING;
      let handle = rest;
      try {
        handle = decodeURIComponent(rest);
      } catch {
        // an address that is not valid encoding: keep it as it came
      }
      handle = handle.trim();
      return handle === "" || handle.length > 200 ? NOT_LANDING : { kind: "product", handle };
    }
    case "cart":
      return { kind: "cart", handle: null };
    case "checkout":
      return { kind: "checkout", handle: null };
    case "order":
      return rest === undefined ? NOT_LANDING : { kind: "order", handle: null };
    default:
      return NOT_LANDING;
  }
}

// ---------------------------------------------------------------------------
// The funnel
// ---------------------------------------------------------------------------

export const FUNNEL_STAGES = [
  { key: "sessions", label: "Visits" },
  { key: "productViewers", label: "Viewed a product" },
  { key: "carts", label: "Added to cart" },
  { key: "checkouts", label: "Reached checkout" },
  { key: "purchases", label: "Purchased" },
] as const;

export type FunnelKey = (typeof FUNNEL_STAGES)[number]["key"];

/** What each stage counted, as visitor-days; null for a stage that cannot be known (visit counting off). */
export type FunnelCounts = Record<FunnelKey, number | null | undefined>;

export type FunnelStage = {
  key: FunnelKey;
  label: string;
  /** What is shown: the count, never more than the last known stage before it. Null when unknown. */
  count: number | null;
  /** What was counted, before it was held to the stage before. */
  raw: number | null;
  /** The count over the first stage's; null when that is 0 or unknown. */
  fromFirst: number | null;
  /** The count over the stage right before's; null for the first stage or when that is 0 or unknown. */
  fromPrevious: number | null;
  /** The raw count was larger than the stage before it and was cut down to it. */
  clamped: boolean;
};

export type Funnel = {
  stages: FunnelStage[];
  /** Visits that viewed a product. */
  productViewRate: number | null;
  /** Visits that added to cart. */
  addToCartRate: number | null;
  /** Of the carts, the share that did not end in a purchase. */
  cartAbandonment: number | null;
  /** Of the visits that reached checkout, the share that did not buy. */
  checkoutAbandonment: number | null;
  /** Purchases over visits. */
  purchaseConversion: number | null;
  /** The stages that were cut down. */
  clampedStages: FunnelKey[];
  /** One sentence for each cut, to show beside the funnel. */
  notes: string[];
};

const count = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : null);

/**
 * The funnel from visits to purchases and the rates read off it. A stage cannot be larger than the one before it (a
 * purchase can come from a visitor whose visit was not counted, or on another day): it is cut down to it, kept as
 * `raw`, flagged, and the rates use the cut figure. A stage that is unknown (null) is skipped when holding the next
 * one down, and every rate that needs it is null. Rates with nothing to divide by are null, never 0.
 */
export function funnel(counts: FunnelCounts): Funnel {
  const stages: FunnelStage[] = [];
  let limit: number | null = null as number | null;
  for (const { key, label } of FUNNEL_STAGES) {
    const raw = count(counts[key]);
    const shown: number | null = raw === null ? null : limit === null ? raw : Math.min(raw, limit);
    const previous = stages[stages.length - 1];
    const first = stages[0];
    stages.push({
      key,
      label,
      count: shown,
      raw,
      fromFirst: previous === undefined ? (shown !== null && shown > 0 ? 1 : null) : safeRatio(shown, first.count),
      fromPrevious: previous === undefined ? null : safeRatio(shown, previous.count),
      clamped: raw !== null && shown !== null && raw > shown,
    });
    if (shown !== null) limit = shown;
  }
  const at = (key: FunnelKey) => stages.find((s) => s.key === key)!.count;
  const abandonment = (of: number | null, bought: number | null) => (of === null || bought === null || of === 0 ? null : 1 - bought / of);
  const clamped = stages.filter((s) => s.clamped);
  const before = (stage: FunnelStage) => {
    const index = stages.indexOf(stage);
    for (let i = index - 1; i >= 0; i--) if (stages[i].count !== null) return stages[i];
    return null;
  };
  return {
    stages,
    productViewRate: safeRatio(at("productViewers"), at("sessions")),
    addToCartRate: safeRatio(at("carts"), at("sessions")),
    cartAbandonment: abandonment(at("carts"), at("purchases")),
    checkoutAbandonment: abandonment(at("checkouts"), at("purchases")),
    purchaseConversion: safeRatio(at("purchases"), at("sessions")),
    clampedStages: clamped.map((s) => s.key),
    notes: clamped.map((s) => {
      const prior = before(s)!;
      return `${s.label} (${s.raw}) is more than ${prior.label} (${prior.count}), so it is shown as ${s.count}.`;
    }),
  };
}

// ---------------------------------------------------------------------------
// The channel table
// ---------------------------------------------------------------------------

/**
 * One channel's figures for a period, from visits and orders joined on the cart's visit. `channel` is a `Channel`
 * or `UNKNOWN_CHANNEL` (orders with no visit). Rows of the same channel (per campaign, say) are added up.
 * Amounts are minor units of the main currency, without VAT.
 */
export type ChannelInput = {
  channel: string;
  /** Visitor-days from this channel; null where they cannot be known (the unknown channel, or counting off). */
  sessions: number | null;
  /** Paid orders attributed to it. */
  orders: number;
  /** Revenue of those orders (without VAT). */
  revenueMinor: number;
  /** Customers whose first paid order is one of them. */
  newCustomers: number;
  /** Marketing spend entered for the channel. */
  spendMinor: number;
  /** Contribution before marketing spend (net revenue less COGS, fees and shipping) of those orders; null when costs are not known. */
  contributionBeforeMarketingMinor: number | null;
};

export type ChannelRow = ChannelInput & {
  label: string;
  /** Orders over sessions. */
  conversion: number | null;
  /** Revenue over orders, rounded to a minor unit. */
  aov: number | null;
  /**
   * Revenue over spend; null with no spend. On the blended row this is ROAS (blended), the revenue of the channels that have ad spend
   * over the spend of those channels (docs/analytics.md, "ROAS"): never all revenue, which is MER (`ChannelTable.mer`).
   */
  roas: number | null;
  /** Spend over new customers, rounded; null with no spend or no new customers. */
  cac: number | null;
  /** Contribution before marketing over spend; null with no spend or unknown costs. On the blended row: of the channels that have spend. */
  profitRoas: number | null;
  /** Share of all the table's revenue. */
  revenueShare: number | null;
};

/** The channels that have ad spend, added up: what the blended ROAS and profit ROAS are made of. */
export type SpendChannels = {
  /** How many channels have spend entered. */
  channels: number;
  /** Their revenue (attributed orders, without VAT). */
  revenueMinor: number;
  /** Their spend. */
  spendMinor: number;
  /** Their contribution before marketing; null when any of them is not known. */
  contributionBeforeMarketingMinor: number | null;
};

export type ChannelTable = {
  /** Largest revenue first, then largest spend, then the channels' own order. */
  rows: ChannelRow[];
  /**
   * All channels together: its CAC is the blended one, its ROAS and profit ROAS are over the channels that have ad spend only
   * (`spendChannels`), and its `revenueMinor` is every sale, direct and organic included.
   */
  blended: ChannelRow;
  /** The channels with ad spend, added up. */
  spendChannels: SpendChannels;
  /** MER (marketing efficiency ratio): every sale divided by every ad krone, whatever channel it came from; null with no spend. */
  mer: number | null;
};

const num = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const addKnown = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : num(a) + num(b));

function derive(input: ChannelInput, label: string, totalRevenue: number): ChannelRow {
  const { sessions, orders, revenueMinor, newCustomers, spendMinor, contributionBeforeMarketingMinor: contribution } = input;
  const spend = spendMinor > 0 ? spendMinor : null;
  return {
    ...input,
    label,
    conversion: sessions !== null && sessions > 0 ? orders / sessions : null,
    aov: orders > 0 ? Math.round(revenueMinor / orders) : null,
    roas: spend === null ? null : revenueMinor / spend,
    cac: spend !== null && newCustomers > 0 ? Math.round(spend / newCustomers) : null,
    profitRoas: spend === null || contribution === null ? null : contribution / spend,
    revenueShare: totalRevenue > 0 ? revenueMinor / totalRevenue : null,
  };
}

/**
 * The Marketing page's table: conversion, AOV, ROAS, CAC and profit ROAS for each channel and for all of them (the "All channels" row's
 * ROAS and profit ROAS are over the channels with ad spend; `mer` is all revenue over all spend).
 */
export function channelTable(rows: readonly ChannelInput[]): ChannelTable {
  const merged = new Map<string, ChannelInput>();
  for (const row of rows) {
    const had = merged.get(row.channel);
    const clean: ChannelInput = {
      channel: row.channel,
      sessions: row.sessions === null ? null : Math.max(0, num(row.sessions)),
      orders: num(row.orders),
      revenueMinor: num(row.revenueMinor),
      newCustomers: num(row.newCustomers),
      spendMinor: num(row.spendMinor),
      contributionBeforeMarketingMinor: row.contributionBeforeMarketingMinor === null ? null : num(row.contributionBeforeMarketingMinor),
    };
    merged.set(
      row.channel,
      had
        ? {
            channel: row.channel,
            sessions: addKnown(had.sessions, clean.sessions),
            orders: had.orders + clean.orders,
            revenueMinor: had.revenueMinor + clean.revenueMinor,
            newCustomers: had.newCustomers + clean.newCustomers,
            spendMinor: had.spendMinor + clean.spendMinor,
            contributionBeforeMarketingMinor: addKnown(had.contributionBeforeMarketingMinor, clean.contributionBeforeMarketingMinor),
          }
        : clean,
    );
  }
  const list = [...merged.values()];
  const total = list.reduce<ChannelInput>(
    (sum, r) => ({
      channel: "blended",
      sessions: addKnown(sum.sessions, r.sessions),
      orders: sum.orders + r.orders,
      revenueMinor: sum.revenueMinor + r.revenueMinor,
      newCustomers: sum.newCustomers + r.newCustomers,
      spendMinor: sum.spendMinor + r.spendMinor,
      contributionBeforeMarketingMinor: addKnown(sum.contributionBeforeMarketingMinor, r.contributionBeforeMarketingMinor),
    }),
    { channel: "blended", sessions: null, orders: 0, revenueMinor: 0, newCustomers: 0, spendMinor: 0, contributionBeforeMarketingMinor: null },
  );
  const order = (key: string) => {
    const index = isChannel(key) ? CHANNELS.findIndex((c) => c.key === key) : CHANNELS.length;
    return index < 0 ? CHANNELS.length : index;
  };
  // ROAS (blended) and profit ROAS count only what the channels with ad spend brought, against what they cost: direct and organic sales
  // are no return on ad spend. MER (all revenue over all spend) is the other, flattering measure and is kept apart.
  const paid = list.filter((r) => r.spendMinor > 0);
  const spendChannels: SpendChannels = {
    channels: paid.length,
    revenueMinor: paid.reduce((sum, r) => sum + r.revenueMinor, 0),
    spendMinor: paid.reduce((sum, r) => sum + r.spendMinor, 0),
    contributionBeforeMarketingMinor: paid.length === 0 || paid.some((r) => r.contributionBeforeMarketingMinor === null) ? null : paid.reduce((sum, r) => sum + num(r.contributionBeforeMarketingMinor), 0),
  };
  // A staff-made order was not a visit: the blended conversion counts the others only.
  const staffOrders = list.find((r) => r.channel === STAFF_CHANNEL)?.orders ?? 0;
  const blendedBase = derive(total, "Blended", total.revenueMinor);
  const blended: ChannelRow = {
    ...blendedBase,
    conversion: total.sessions !== null && total.sessions > 0 ? Math.max(0, total.orders - staffOrders) / total.sessions : null,
    roas: spendChannels.spendMinor > 0 ? spendChannels.revenueMinor / spendChannels.spendMinor : null,
    profitRoas:
      spendChannels.spendMinor > 0 && spendChannels.contributionBeforeMarketingMinor !== null ? spendChannels.contributionBeforeMarketingMinor / spendChannels.spendMinor : null,
  };
  const derived = list
    .map((r) => derive(r, channelLabel(r.channel), total.revenueMinor))
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.spendMinor - a.spendMinor || order(a.channel) - order(b.channel) || a.channel.localeCompare(b.channel));
  return { rows: derived, blended, spendChannels, mer: total.spendMinor > 0 ? total.revenueMinor / total.spendMinor : null };
}

/** Predicted lifetime value over what it cost to win a customer; null when either is unknown or CAC is not above zero. */
export function ltvToCac(ltvMinor: number | null | undefined, cacMinor: number | null | undefined): number | null {
  if (typeof ltvMinor !== "number" || typeof cacMinor !== "number" || !Number.isFinite(ltvMinor) || !Number.isFinite(cacMinor) || cacMinor <= 0) return null;
  return ltvMinor / cacMinor;
}
