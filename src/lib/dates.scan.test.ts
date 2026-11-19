import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Dates outside the admin (code review 1.14's next, FS11, D796): the storefront, shoppers' emails, contracts, the platform's own site and
 * mail, and the server code behind them show a moment with `dateIn(where, at, style, locale)` from `src/lib/dates.ts`, in the store's own
 * zone (`store`, `store.timeZone`, or `storeZoneOf(row.time_zone)` for a row read without a type), Kaizena Flow's own in
 * `PLATFORM_TIME_ZONE`, Norway-only features in `NORWAY_TIME_ZONE`, and a calendar day with `calendarDate()`. Three rules, as
 * `admin-dates.scan.test.ts` holds the admin to the first two:
 *
 * 1. No zone written out (`Europe/Oslo`, which put every store on Norwegian time) in any source outside the admin, but the kept lines below.
 * 2. No day or time cut from a UTC string (`.slice(0, 10)`, `.slice(0, 16)`) in storefront code (`src/components`, `src/app`, the admin
 *    left out) or in email code (a file under `src/lib` or `src/server` whose name says email), but the kept cuts below.
 * 3. No date formatted without a zone (`toLocaleDateString(locale)`, `Intl.DateTimeFormat(locale, { dateStyle })` and the like with no
 *    `timeZone`) anywhere outside the admin: on the server it is UTC's day (Vercel's clock), in a client part the browser's, so a page
 *    and its hydration disagree.
 *
 * Each kept case is listed per file with its count and its reason. A count only falls (`docs/rules/budgets.md`).
 */

/** Why a line keeps what the rule forbids. */
type Why =
  /** `PLATFORM_TIME_ZONE` and `NORWAY_TIME_ZONE` themselves. */
  | "constant"
  /** `commerce.stores.time_zone`'s default, the platform's zone. */
  | "default"
  /** A test's or an eval's own store, written as it is. */
  | "fixture"
  /** Norway's row in a table of countries' zones. */
  | "country"
  /** SQL of the platform's own reports (sales, books, payouts, channels): Kaizena Flow's clock, never a store's figures. */
  | "sql"
  /** Not a date a person reads: an idempotency key, a hash's salt, a rate limit's bucket or a cookie's day. */
  | "key"
  /** The first ten items of a list. */
  | "list"
  /** A moment written with "UTC" after it, so it says which clock it is. */
  | "labelled"
  /** Calendar arithmetic on days at noon UTC, never a moment. */
  | "arithmetic"
  /** Formatted only in the browser (a client part that draws nothing on the server), in the viewer's own zone. */
  | "browser";

type Kept = { count: number; why: Why };

const ZONE_WRITTEN = /Europe\/Oslo/;
const CUT = /\.slice\(0, ?1[06]\)/;
const ADMIN = ["src/app/admin/", "src/components/admin/"];

/** Rule 1: the lines that still write the zone out. */
const KEPT_ZONES: Record<string, Kept> = {
  "src/lib/admin-date.ts": { count: 2, why: "constant" },
  "src/db/schema.ts": { count: 1, why: "default" },
  "src/db/invoice-fixture.ts": { count: 1, why: "fixture" },
  "src/server/owner-assistant.ts": { count: 1, why: "fixture" },
  "src/lib/phone.ts": { count: 1, why: "country" },
  "src/lib/tracking-phases.ts": { count: 1, why: "country" },
  "src/server/platform-sales.ts": { count: 2, why: "sql" },
  "src/server/platform-books.ts": { count: 2, why: "sql" },
  "src/server/platform-channels.ts": { count: 3, why: "sql" },
  "src/server/platform-payouts.ts": { count: 1, why: "sql" },
};

/** Rule 2: the cuts storefront and email code keeps. */
const KEPT_CUTS: Record<string, Kept> = {
  "src/app/(platform)/get-domain/actions.ts": { count: 1, why: "key" },
  "src/app/api/ads/signals/route.ts": { count: 1, why: "list" },
  "src/app/api/feeds/[token]/[file]/route.ts": { count: 1, why: "key" },
  "src/app/api/private/unlock/route.ts": { count: 1, why: "key" },
  "src/app/api/sms/[key]/delivered/route.ts": { count: 1, why: "key" },
  "src/app/api/sms/[key]/inbound/route.ts": { count: 1, why: "key" },
  "src/app/api/ucp/[store]/mcp/route.ts": { count: 1, why: "key" },
  "src/components/platform-routes/status.tsx": { count: 1, why: "labelled" },
  "src/components/touch-keeper.tsx": { count: 1, why: "key" },
  "src/lib/delivery-email.ts": { count: 1, why: "arithmetic" },
  "src/server/bonus-emails.ts": { count: 1, why: "key" },
  "src/server/domain-emails.ts": { count: 1, why: "key" },
  "src/server/draft-emails.ts": { count: 1, why: "key" },
  "src/server/kaizen-life-emails.ts": { count: 1, why: "labelled" },
  "src/server/security-emails.ts": { count: 1, why: "labelled" },
  "src/server/work-emails.ts": { count: 1, why: "key" },
};

/** Rule 3: the dates formatted without a zone that are kept. */
const KEPT_ZONELESS: Record<string, Kept> = {
  "src/components/countdown-view.tsx": { count: 1, why: "browser" },
  "src/lib/replicate.ts": { count: 1, why: "browser" },
};

/** The ceilings of the three lists (only fall). */
const CEILINGS = { zones: 15, cuts: 16, zoneless: 2 };

/** Every source file under a folder, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const root = process.cwd();
const files = sources(path.join(root, "src"))
  .map((file) => path.relative(root, file).split(path.sep).join("/"))
  .filter((rel) => !ADMIN.some((dir) => rel.startsWith(dir)))
  .map((rel) => ({ rel, text: readFileSync(path.join(root, rel), "utf8") }));

const storefront = (rel: string) => rel.startsWith("src/components/") || rel.startsWith("src/app/");
const email = (rel: string) => /^src\/(lib|server)\/[^/]*email[^/]*\.tsx?$/.test(rel);

const CALL = /(toLocaleDateString|toLocaleString|toLocaleTimeString|Intl\.DateTimeFormat)\(/g;
const DATE_PARTS = /dateStyle|timeStyle|\bday\b|\bmonth\b|\byear\b|weekday|\bhour\b|\bminute\b/;

/** The date formatting calls in a text that name no zone: a number's `toLocaleString()` (no date parts) is not one. */
function zoneless(text: string): number[] {
  const lines: number[] = [];
  for (const m of text.matchAll(CALL)) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const args = text.slice(m.index + m[0].length, i - 1);
    const isDate = m[1] === "toLocaleDateString" || m[1] === "toLocaleTimeString" || DATE_PARTS.test(args);
    if (isDate && !/timeZone/.test(args)) lines.push(text.slice(0, m.index).split("\n").length);
  }
  return lines;
}

const lineCount = (text: string, pattern: RegExp) => text.split("\n").filter((line) => pattern.test(line)).length;

const counts = {
  zones: new Map(files.map(({ rel, text }) => [rel, lineCount(text, ZONE_WRITTEN)])),
  cuts: new Map(files.filter(({ rel }) => storefront(rel) || email(rel)).map(({ rel, text }) => [rel, lineCount(text, CUT)])),
  zoneless: new Map(files.map(({ rel, text }) => [rel, zoneless(text).length])),
};

const ADVICE = {
  zones: "use the store's zone (store.timeZone, storeZoneOf(row.time_zone)), PLATFORM_TIME_ZONE or NORWAY_TIME_ZONE from src/lib/dates.ts",
  cuts: "show the date with dateIn(store, at, style, locale), or calendarDate(day, style, locale) for a calendar day (src/lib/dates.ts)",
  zoneless: "give it the store's zone: dateIn(store, at, style, locale) from src/lib/dates.ts",
};

const lists = { zones: KEPT_ZONES, cuts: KEPT_CUTS, zoneless: KEPT_ZONELESS } as const;

describe("dates outside the admin (code review 1.14's next, FS11, D796)", () => {
  it("reads the storefront, email and server sources", () => {
    expect(files.length).toBeGreaterThan(1500);
    expect(files.some(({ rel }) => rel === "src/server/shopper-emails.ts")).toBe(true);
    expect(files.some(({ rel }) => rel.startsWith("src/app/admin/"))).toBe(false);
  });

  it("finds a date formatted without a zone, and passes one with it or a number", () => {
    expect(zoneless(`new Date(at).toLocaleDateString(locale, { dateStyle: "long" })`)).toEqual([1]);
    expect(zoneless(`x\nnew Intl.DateTimeFormat(locale, {\n  day: "numeric",\n})`)).toEqual([2]);
    expect(zoneless(`new Date(at).toLocaleDateString(locale, { dateStyle: "long", timeZone })`)).toEqual([]);
    expect(zoneless(`n.toLocaleString(locale, { maximumFractionDigits: 2 })`)).toEqual([]);
  });

  for (const rule of ["zones", "cuts", "zoneless"] as const) {
    it(`${rule}: nothing beyond the kept cases`, () => {
      const over = [...counts[rule]].flatMap(([rel, n]) => {
        const kept = lists[rule][rel]?.count ?? 0;
        return n > kept ? [`${rel}: ${n} found, ${kept} kept. ${ADVICE[rule]}.`] : [];
      });
      expect(over).toEqual([]);
    });

    it(`${rule}: the list is as low as the code (lower a count, or take out a file, once its case is gone)`, () => {
      const high = Object.entries(lists[rule])
        .filter(([rel, kept]) => (counts[rule].get(rel) ?? 0) < kept.count)
        .map(([rel, kept]) => `${rel}: ${counts[rule].get(rel) ?? 0} found, ${kept.count} kept`);
      expect(high).toEqual([]);
    });

    it(`${rule}: the kept cases stay under their ceiling (only falls)`, () => {
      expect(Object.values(lists[rule]).reduce((sum, kept) => sum + kept.count, 0)).toBeLessThanOrEqual(CEILINGS[rule]);
    });
  }
});
