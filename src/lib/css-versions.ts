/**
 * Versions of a site's own CSS (wave 11 unit F, D385; kept by `src/server/css-versions.ts`): the CSS as each save of the page builder's CSS
 * panel left it, and who saved it. Pure, so the panel can compare a version with what it holds.
 */

/** How many versions of its CSS a site keeps. */
export const CSS_VERSIONS_KEPT = 50;

export type CssVersionItem = { id: string; at: string; by: string | null; length: number };

/** The CSS panel's versions (D385): the list, newest first, and one version's CSS to hold as unsaved. */
export type CssVersionActions = {
  list: () => Promise<CssVersionItem[]>;
  read: (version: string) => Promise<{ ok: true; css: string } | { ok: false; problem: string }>;
};

/**
 * How a version differs from what the panel holds, in lines: those the version has that the panel does not (added if it is taken back) and
 * those the panel has that the version does not (removed). Lines are compared trimmed, empty ones left out, each counted as often as it
 * appears.
 */
export function cssLineChanges(current: string, version: string): { added: number; removed: number } {
  const lines = (css: string) => css.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const counts = new Map<string, number>();
  for (const line of lines(current)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of lines(version)) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  const removed = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return { added, removed };
}
