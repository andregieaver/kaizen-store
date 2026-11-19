import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { zoneless } from "@/test/zoneless-dates";

/**
 * Dates in the admin (code review 1.14, FS5, D786): an instant is shown with `adminDate(zone, at, style, lang)` from `src/lib/admin-date.ts`
 * in the store's zone (each row's own store where a screen spans stores), Kaizena Flow's figures in `PLATFORM_TIME_ZONE`, and Norway-only
 * features in `NORWAY_TIME_ZONE`; a calendar day with `adminDay()`. So admin code never writes a zone out (`Europe/Oslo`, which put every
 * store on Norwegian time) and never cuts a date or a time from a UTC string (`.slice(0, 10)`, `.slice(0, 16)`), which put an evening order on
 * the next day west of UTC and gave one order two dates.
 *
 * A cut that is not a date shown to a person is kept below, per file, with its reason: `list` (the first ten items of a list), `typed` (a
 * form's text cut to its length, already on the store's clock), `local` (the day part of a `datetime-local` text, already on the store's
 * clock) or `file` (a file name stamped with the moment the file itself holds). A count only falls (`docs/rules/budgets.md`).
 *
 * And no date formatted without a zone (D812, rule 3 of `dates.scan.test.ts`, the same detector: `toLocaleDateString(locale)`,
 * `Intl.DateTimeFormat(locale, { dateStyle })` and the like with no `timeZone`): on the server it is UTC's day, in a client part the
 * browser's, so a page and its hydration disagree and a store's evening order shows on another day. Give it `adminDate(zone, at, style,
 * lang)`. The only ones kept are `browser`: a time set in the browser and shown on the viewer's own clock on purpose, never drawn on the
 * server, listed below with what each is.
 */

const DIRS = ["src/app/admin", "src/components/admin"];
const ZONE_WRITTEN = /Europe\/Oslo/;
const CUT = /\.slice\(0, ?1[06]\)/;

type Kept = { count: number; why: "list" | "typed" | "local" | "file" };

const KEPT: Record<string, Kept> = {
  "src/app/admin/(gated)/[store]/analytics/marketing/actions.ts": { count: 1, why: "list" },
  "src/app/admin/(gated)/[store]/pages/schedule-actions.ts": { count: 2, why: "typed" },
  "src/app/admin/(gated)/[store]/settings/design/themes/[install]/actions.ts": { count: 2, why: "typed" },
  "src/app/admin/(gated)/platform/stores/[store]/actions.ts": { count: 1, why: "list" },
  "src/components/admin/ai-memory.tsx": { count: 1, why: "file" },
  "src/components/admin/campaign-editor.tsx": { count: 1, why: "local" },
  "src/components/admin/css-panel.tsx": { count: 1, why: "list" },
  "src/components/admin/discount-editor.tsx": { count: 2, why: "local" },
};

/** Rule 3's kept dates, each formatted only in the browser on the viewer's own clock, on purpose (D812). */
const KEPT_ZONELESS: Record<string, { count: number; why: "browser"; what: string }> = {
  "src/components/admin/drafts/draft-editor.tsx": { count: 1, why: "browser", what: "Saved at: the moment the person just saved, set by their own press" },
  "src/components/admin/leave-dialogs.tsx": { count: 1, why: "browser", what: "RestoreBar: when unsaved changes were kept in this browser" },
};

/** Every source file under a folder, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const root = process.cwd();
const files = DIRS.flatMap((dir) => sources(path.join(root, dir))).map((file) => ({
  rel: path.relative(root, file).split(path.sep).join("/"),
  lines: readFileSync(file, "utf8").split("\n"),
}));

describe("admin dates (code review 1.14, FS5, D786)", () => {
  it("reads every admin source file", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("writes no time zone out: a store's zone, PLATFORM_TIME_ZONE or NORWAY_TIME_ZONE (src/lib/admin-date.ts)", () => {
    const found = files.flatMap(({ rel, lines }) => lines.flatMap((line, i) => (ZONE_WRITTEN.test(line) ? [`${rel}:${i + 1}`] : [])));
    expect(found, "show the date with adminDate(store, at, style, lang) from src/lib/admin-date.ts").toEqual([]);
  });

  it("cuts no date from a UTC string beyond the kept cases", () => {
    const over = files.flatMap(({ rel, lines }) => {
      const n = lines.filter((line) => CUT.test(line)).length;
      const kept = KEPT[rel]?.count ?? 0;
      return n > kept ? [`${rel}: ${n} cut, ${kept} kept. Show the date with adminDate(store, at, style, lang), or adminDay(day, style, lang) for a calendar day.`] : [];
    });
    expect(over).toEqual([]);
  });

  it("keeps the allowlist as low as the code: lower a count, or take out a file, once its cut is gone", () => {
    const counts = new Map(files.map(({ rel, lines }) => [rel, lines.filter((line) => CUT.test(line)).length]));
    const high = Object.entries(KEPT)
      .filter(([rel, kept]) => (counts.get(rel) ?? 0) < kept.count)
      .map(([rel, kept]) => `${rel}: ${counts.get(rel) ?? 0} cut, ${kept.count} kept`);
    expect(high).toEqual([]);
  });

  it("holds the kept cases to their ceiling (only falls)", () => {
    expect(Object.values(KEPT).reduce((sum, kept) => sum + kept.count, 0)).toBeLessThanOrEqual(11);
  });

  it("formats no date without a zone beyond the kept browser ones (D812)", () => {
    const over = files.flatMap(({ rel, lines }) => {
      const n = zoneless(lines.join("\n")).length;
      const kept = KEPT_ZONELESS[rel]?.count ?? 0;
      return n > kept ? [`${rel}: ${n} found, ${kept} kept. Give it the zone: adminDate(store, at, style, lang), or PLATFORM_TIME_ZONE for Kaizena Flow's own and an account's records.`] : [];
    });
    expect(over).toEqual([]);
  });

  it("keeps the zoneless list as low as the code: lower a count, or take out a file, once its date is gone", () => {
    const high = Object.entries(KEPT_ZONELESS)
      .filter(([rel, kept]) => zoneless(files.find((f) => f.rel === rel)?.lines.join("\n") ?? "").length < kept.count)
      .map(([rel, kept]) => `${rel}: fewer than ${kept.count} kept`);
    expect(high).toEqual([]);
  });

  it("holds the kept zoneless dates to their ceiling (only falls)", () => {
    expect(Object.values(KEPT_ZONELESS).reduce((sum, kept) => sum + kept.count, 0)).toBeLessThanOrEqual(2);
  });
});
