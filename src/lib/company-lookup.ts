import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * Which companies visited (D890, `docs/analytics.md` "Companies"): the pure parts of the company lookup. No `server-only` so it can be
 * tested; it runs on the server only, because it is handed the server's secret and the visitor's address there and nowhere else.
 *
 * The lookup is Leadfeeder's IP Enrich API (`GET https://api.leadfeeder.com/v1/ip/enrich?ip=…&account_id=…`, header `X-Api-Key`; its
 * OpenAPI file, read 2026-11-24). It answers whether the address is a company's network (`company_type` `company`, which Leadfeeder bills
 * as a match) or a shared one (`shared_network`: a home or mobile connection, a university, a coworking space), and for a company its
 * name, legal form, website, industries, headcount range, address and register number. Nothing here reads the answer as anything but
 * text: a company's name is data, never markup.
 */

export const LEADFEEDER_HOST = "api.leadfeeder.com";
export const LEADFEEDER_ENRICH_PATH = "/v1/ip/enrich";
/** How long one lookup may take; a slower one is a failure, and the visit is counted without its company. */
export const LOOKUP_TIMEOUT_MS = 3000;
/** The most of an answer that is read (a company with every field is a few kilobytes). */
export const LOOKUP_MAX_BODY_BYTES = 64 * 1024;
/**
 * Lookups one store may start in a store day that the day's answers do not already hold. Leadfeeder bills each company it names, so this
 * bounds what a script on a company network, or a flood of new addresses, can cost; past it visits are counted without their company.
 */
export const LOOKUPS_PER_STORE_DAY = 2000;
/** Pages kept per company and day; past it a page counts under `OTHER_PAGE` ("(other)", `recordCompanyVisit()`). */
export const COMPANY_PAGES_KEPT = 30;
/** Days a day's answers are kept (`company_lookups`), so a day that straddles midnight finds its own. */
export const LOOKUP_KEEP_DAYS = 2;

/** A counted page view handed to the company step (`recordVisit()` → `recordCompanyVisit()`); the address lives only in memory. */
export type CompanyVisitInput = {
  storeId: string;
  /** The store day the visit was counted under (`visits.day`). */
  day: string;
  /** The page view started the visitor's row for the day (`recordVisit()`'s first page view). */
  newVisitor: boolean;
  /** The page as `placeOfPath()` kept it. */
  page: string;
  address: string;
  now?: Date;
};

export type CompanyFacts = {
  sourceId: string;
  name: string;
  legalForm: string | null;
  domain: string | null;
  countryCode: string | null;
  city: string | null;
  industry: string | null;
  employees: string | null;
  registerId: string | null;
  doNotContact: boolean;
};

/** What a lookup came to: a company, nothing to show (a shared network or none found), or a failure (asked again the next day). */
export type LookupAnswer = { kind: "company"; company: CompanyFacts } | { kind: "none" } | { kind: "failed"; reason: string };

/** The request's address: the fixed host and path, with only the checked address and the account's digits in the query. */
export function enrichUrl(address: string, accountId: string): string {
  const url = new URL(`https://${LEADFEEDER_HOST}${LEADFEEDER_ENRICH_PATH}`);
  url.searchParams.set("ip", address);
  url.searchParams.set("account_id", accountId);
  return url.toString();
}

const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** A trimmed text of at most `max` characters with no control characters, or null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean.slice(0, max);
}

/** The host of a website's address without `www.`, or null for anything that is not an http(s) address. */
export function domainOf(url: unknown): string | null {
  const raw = text(url, 500);
  if (!raw) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

/** The first industry Leadfeeder names: its own classification first, then NACE. */
function industryOf(industries: unknown): string | null {
  const all = obj(industries);
  for (const list of [all?.industry, all?.nace]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const name = text(obj(item)?.name, 200);
      if (name) return name;
    }
  }
  return null;
}

/**
 * Reads Leadfeeder's 200 answer. A company only when `company_type` is `company` and the company has an id and a name; a shared network,
 * or a company without them, is nothing to show. Anything that is not the shape the API documents is a failure, never a guess.
 */
export function readEnrichAnswer(json: unknown): LookupAnswer {
  const data = obj(obj(json)?.data);
  const attributes = obj(data?.attributes);
  if (!data || !attributes) return { kind: "failed", reason: "shape" };
  if (attributes.company_type !== "company") return { kind: "none" };
  const company = obj(obj(data.relationships)?.company);
  const facts = obj(company?.attributes);
  const sourceId = text(company?.id, 100);
  const name = text(facts?.name, 200);
  if (!company || !facts || !sourceId || !name) return { kind: "none" };
  const address = obj(facts.address);
  const country = text(address?.country_code, 2)?.toUpperCase() ?? null;
  return {
    kind: "company",
    company: {
      sourceId,
      name,
      legalForm: text(facts.legal_form, 100),
      domain: domainOf(facts.url),
      countryCode: country && /^[A-Z]{2}$/.test(country) ? country : null,
      city: text(address?.city, 100),
      industry: industryOf(facts.industries),
      employees: text(facts.employee_range, 30),
      registerId: text(obj(facts.register)?.id, 60),
      doNotContact: obj(facts.meta)?.do_not_contact === true,
    },
  };
}

/**
 * Legal forms whose company is one person, as registers and Leadfeeder write them, lower-case and without dots: a sole trader is never
 * shown, since its name is a person's (Norway's ENK, Germany's Einzelunternehmen and e.K., Sweden's enskild firma, Denmark's
 * enkeltmandsvirksomhed, Finland's toiminimi, France's entreprise individuelle, Italy's ditta individuale, Spain's empresario individual,
 * the Netherlands' eenmanszaak, Poland's jednoosobowa działalność, the UK's sole trader).
 */
const SOLE_TRADER_FORMS: readonly string[] = [
  "enk",
  "enkeltpersonforetak",
  "einzelunternehmen",
  "einzelunternehmer",
  "einzelfirma",
  "ek",
  "eingetragener kaufmann",
  "eingetragene kauffrau",
  "enskild firma",
  "enskild näringsidkare",
  "enskild naringsidkare",
  "enkeltmandsvirksomhed",
  "personligt ejet mindre virksomhed",
  "toiminimi",
  "tmi",
  "yksityinen elinkeinonharjoittaja",
  "entreprise individuelle",
  "ei",
  "eirl",
  "micro-entreprise",
  "auto-entrepreneur",
  "ditta individuale",
  "impresa individuale",
  "empresario individual",
  "autónomo",
  "autonomo",
  "eenmanszaak",
  "eenmanszaak (onderneming)",
  "jednoosobowa działalność gospodarcza",
  "jednoosobowa dzialalnosc gospodarcza",
  "osvč",
  "osvc",
  "egyéni vállalkozó",
  "egyeni vallalkozo",
  "sole trader",
  "sole proprietor",
  "sole proprietorship",
];

/** Whether a legal form is a sole trader's (`SOLE_TRADER_FORMS`), whatever its case, dots and spaces. */
export function isSoleTrader(legalForm: string | null | undefined): boolean {
  if (!legalForm) return false;
  const form = legalForm.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return SOLE_TRADER_FORMS.includes(form);
}

/** A Norwegian organisation number from a register id (`923609016`, `923 609 016`, `NO923609016MVA`), or null. */
export function norwegianNumber(registerId: string | null | undefined): string | null {
  if (!registerId) return null;
  const digits = registerId.toUpperCase().replace(/^NO/, "").replace(/MVA$/, "").replace(/[\s.-]/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

/**
 * An address worth asking about: a valid IPv4 or IPv6 address that is public. Private, loopback, link-local and other special ranges
 * are never a company's public network, so they are not sent.
 */
export function isLookupAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    if (/^(fe[89ab]|fc|fd|ff)/.test(lower)) return false;
    if (lower.startsWith("::ffff:")) return isLookupAddress(lower.slice(7));
    return true;
  }
  return false;
}

/**
 * The key of a day's answer for an address: `HMAC(secret, ["company-lookup", day, address])` cut to 32 hex characters. The table of answers
 * then holds no address, and one that could only be tested with the server's secret; the day in the key means a key is never the same
 * from one day to the next.
 */
export function lookupKey(secret: string, day: string, address: string): string {
  if (!secret) throw new Error("A lookup key needs a secret.");
  return createHmac("sha256", secret).update(JSON.stringify(["company-lookup", day, address])).digest("hex").slice(0, 32);
}

/**
 * How a page is shown: the shape `placeOfPath()` kept (`/no/pricing`), without the country in front for a store that has no country in
 * its addresses (D181), and `/` for its front page.
 */
export function pageLabel(shape: string, marketless: boolean): string {
  if (!marketless) return shape;
  const rest = shape.replace(/^\/[a-z]{2}(?=\/|$)/, "");
  return rest === "" ? "/" : rest;
}

/** One company's day as read for the report. */
export type CompanyDay = {
  companyId: string;
  day: string;
  visitors: number;
  pageViews: number;
  pages: Record<string, number>;
  lastSeen: string;
};

/** A company over a period: its days, the visitor-days and page views summed, its pages most viewed first. */
export type CompanySummary = {
  companyId: string;
  /** Visitor-days: a person from its network on one day counts once that day. */
  visits: number;
  /** Days with at least one visit. */
  days: number;
  pageViews: number;
  lastSeen: string;
  /** Visits per day, oldest first, one entry for every day of the period. */
  series: number[];
  pages: { page: string; views: number }[];
};

/**
 * The period's companies (`docs/analytics.md` "Companies"): one summary per company, most recently seen first, then most visits. `days` are
 * the period's days oldest first (`YYYY-MM-DD`), which the series follows; a row outside them is left out.
 */
export function companySummaries(rows: readonly CompanyDay[], days: readonly string[]): CompanySummary[] {
  const index = new Map(days.map((day, i) => [day, i]));
  const byCompany = new Map<string, CompanySummary & { pageMap: Map<string, number> }>();
  for (const row of rows) {
    const at = index.get(row.day);
    if (at === undefined) continue;
    let entry = byCompany.get(row.companyId);
    if (!entry) {
      entry = { companyId: row.companyId, visits: 0, days: 0, pageViews: 0, lastSeen: row.lastSeen, series: days.map(() => 0), pages: [], pageMap: new Map() };
      byCompany.set(row.companyId, entry);
    }
    // One row per company and day, so a day is counted once.
    entry.visits += row.visitors;
    entry.pageViews += row.pageViews;
    entry.series[at] += row.visitors;
    if (row.visitors > 0 || row.pageViews > 0) entry.days += 1;
    if (row.lastSeen > entry.lastSeen) entry.lastSeen = row.lastSeen;
    for (const [page, views] of Object.entries(row.pages)) {
      if (Number.isFinite(views) && views > 0) entry.pageMap.set(page, (entry.pageMap.get(page) ?? 0) + views);
    }
  }
  return [...byCompany.values()]
    .map(({ pageMap, ...summary }) => ({
      ...summary,
      pages: [...pageMap.entries()].map(([page, views]) => ({ page, views })).sort((a, b) => b.views - a.views || a.page.localeCompare(b.page)),
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.visits - a.visits);
}
