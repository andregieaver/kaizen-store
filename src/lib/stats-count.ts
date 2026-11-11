/**
 * Animated stats (D561), pure: each figure the owner typed counts up from zero when it comes into view, easing out, and rests on the figure
 * as typed. The figure is the owner's own claim, never looked up; the page's HTML already holds it, so without scripts, for search engines
 * and for visitors who prefer less motion it is simply there.
 */

export const STAT_ITEMS_MAX = 8;
export const STAT_DURATION_DEFAULT = 2;
export const STAT_VALUE_MAX = 1e12;

/** How far along a count is, 0 to 1, eased out (fast, then slowing to the figure). */
export function easeOut(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 1 - (1 - p) ** 3;
}

/** The figure shown `elapsed` ms into a count of `duration` ms, rounded to the figure's own decimals; the figure itself at the end. */
export function countAt(value: number, decimals: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return value;
  const factor = 10 ** decimals;
  return Math.round(value * easeOut(elapsed / duration) * factor) / factor;
}

/** A figure in the page's language, with its own number of decimals (a thousands separator as the language writes one). */
export function statText(value: number, decimals: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  } catch {
    return value.toFixed(decimals);
  }
}
