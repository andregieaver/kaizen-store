/**
 * Which OSS and IOSS returns the owner has not yet taken the data for (D161, `docs/wave-1c-reports.md` 2.2, "What needs you"). Pure: the server
 * passes the profile, the periods whose Return data was exported in filing mode, and the store's own `today`.
 *
 * It says only what Kaizen knows: a period has ended, its deadline is near or past, and no Return data was exported from here. It never says a
 * return is late: Kaizen does not know what was filed, or by whom. Needs review: accountant (deadline sentences).
 */
import { addDays } from "./analytics-period";
import type { TaxProfile } from "./tax-profile";
import { deadlineOf, deadlineState, longDate, periodLabel, shiftPeriod, lastCompletedMonth, lastCompletedQuarter, type TaxPeriod } from "./tax-periods";

export type DueProfile = Pick<TaxProfile, "ossScheme" | "ossRegisteredOn" | "iossNumber" | "iossIntermediary" | "iossRegisteredOn">;

export type ReturnDue = {
  scheme: "oss" | "ioss";
  period: TaxPeriod;
  deadline: string;
  state: "due_soon" | "passed";
  /** The sentence for the owner's attention list. */
  text: string;
  /** The page's address under the store, `?view=` and the period's own parameter. */
  path: string;
};

/** How many of the latest ended periods are looked at: an older one is no longer news. */
export const RETURNS_LOOKED_BACK = 2;

/** A deadline that passed longer ago than this is no longer news: the item goes quiet instead of nagging for ever. */
export const PASSED_NEWS_DAYS = 45;

/** The key the export log keeps a period under (`returnExportKeys()`): `oss:2026-Q3`, `ioss:2026-09`. */
export const exportKey = (scheme: "oss" | "ioss", period: Pick<TaxPeriod, "key">): string => `${scheme}:${period.key}`;

/** The periods of a scheme that a registration could have returns for, newest first. */
export function candidatePeriods(scheme: "oss" | "ioss", today: string): TaxPeriod[] {
  const latest = scheme === "oss" ? lastCompletedQuarter(today) : lastCompletedMonth(today);
  return Array.from({ length: RETURNS_LOOKED_BACK }, (_, i) => shiftPeriod(latest, -i));
}

/** Whether the profile has a registration whose data the owner takes themselves: an IOSS number with an intermediary has the intermediary file it. */
export function schemesOf(profile: DueProfile): ("oss" | "ioss")[] {
  const schemes: ("oss" | "ioss")[] = [];
  if (profile.ossScheme === "union" || profile.ossScheme === "non_union") schemes.push("oss");
  if (profile.iossNumber && !profile.iossIntermediary) schemes.push("ioss");
  return schemes;
}

const registeredOn = (profile: DueProfile, scheme: "oss" | "ioss") => (scheme === "oss" ? profile.ossRegisteredOn : profile.iossRegisteredOn);

/**
 * The returns whose data has not been exported: the latest ended periods of each scheme the profile has, from the day of registration (a
 * period that ended before it is not one), whose deadline is within 14 days or passed in the last 45 days, and that are not in `exported` or not in
 * `hasSales` (a period with nothing to report has nothing to export; when `hasSales` is left out every period counts).
 */
export function returnsDue(profile: DueProfile, exported: ReadonlySet<string>, today: string, hasSales?: ReadonlySet<string>): ReturnDue[] {
  const found: ReturnDue[] = [];
  for (const scheme of schemesOf(profile)) {
    for (const period of candidatePeriods(scheme, today)) {
      const since = registeredOn(profile, scheme);
      if (since && period.lastDay < since) continue;
      const state = deadlineState(period, today);
      if (state !== "due_soon" && state !== "passed") continue;
      if (state === "passed" && today > addDays(deadlineOf(period), PASSED_NEWS_DAYS)) continue;
      const key = exportKey(scheme, period);
      if (exported.has(key) || (hasSales && !hasSales.has(key))) continue;
      const label = scheme === "oss" ? "OSS" : "IOSS";
      const deadline = deadlineOf(period);
      const due = longDate(deadline).replace(/ \d{4}$/, "");
      found.push({
        scheme,
        period,
        deadline,
        state,
        text:
          state === "passed"
            ? `Your ${label} data for ${periodLabel(period)} has not been exported; the due date, ${due}, has passed.`
            : `Your ${label} data for ${periodLabel(period)} has not been exported; it is due ${due}.`,
        path: `/analytics/tax?view=${scheme}&${scheme === "oss" ? "quarter" : "month"}=${period.key}`,
      });
    }
  }
  return found;
}
