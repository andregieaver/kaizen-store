/**
 * Admin heatmaps' figures per screen (D895 phase 3b, Platform → Admin use): the arithmetic, in code. A share is left out (null) below
 * `ADMIN_MIN_VIEWS` views, never guessed, as the stores' heatmaps leave out a figure below their minimum. Screens with the highest share of
 * views with a dead or rage click come first; screens too thin to say come last, busiest first. Pure.
 */

/** Views a screen needs before its shares are shown. */
export const ADMIN_MIN_VIEWS = 20;

export type AdminScreenTotals = {
  screen: string;
  views: number;
  frustrated: number;
  dead: number;
  rage: number;
  deep: number;
};

export type AdminScreenRow = {
  screen: string;
  views: number;
  deadClicks: number;
  rageClicks: number;
  /** Per cent of views with a dead or rage click, whole numbers; null below the minimum. */
  frustratedPct: number | null;
  /** Per cent of views scrolled to the end of the screen; null below the minimum. */
  endPct: number | null;
};

const pct = (part: number, whole: number) =>
  Math.round((Math.min(part, whole) / whole) * 100);

export function adminScreenRows(
  rows: readonly AdminScreenTotals[],
): AdminScreenRow[] {
  return rows
    .filter((r) => r.views > 0)
    .map((r) => {
      const enough = r.views >= ADMIN_MIN_VIEWS;
      return {
        screen: r.screen,
        views: r.views,
        deadClicks: r.dead,
        rageClicks: r.rage,
        frustratedPct: enough ? pct(r.frustrated, r.views) : null,
        endPct: enough ? pct(r.deep, r.views) : null,
      };
    })
    .sort(
      (a, b) =>
        (b.frustratedPct ?? -1) - (a.frustratedPct ?? -1) ||
        b.views - a.views ||
        a.screen.localeCompare(b.screen),
    );
}
