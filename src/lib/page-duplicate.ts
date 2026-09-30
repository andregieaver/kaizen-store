import { PAGE_TITLE_MAX } from "./page-content";

/**
 * Naming a duplicated page (or article, layout, header or footer): its title starts with "Copy of", and its address
 * is the original's with `-copy` after it, then `-copy-2`, `-copy-3` … the first the owner does not already use.
 * An address is at most 80 characters (`pages_slug_format`), so a long one is cut before the suffix, never after it.
 */

export const SLUG_MAX = 80;

/** "Copy of About us"; a copy of a copy stays "Copy of About us", not "Copy of Copy of …". */
export function copyTitle(title: string): string {
  const base = title.trim().replace(/^Copy of\s+/i, "");
  return `Copy of ${base}`.slice(0, PAGE_TITLE_MAX).trimEnd();
}

/** The first free address for a copy of `slug`, given the addresses the owner's pages already use. */
export function copySlug(slug: string, taken: ReadonlySet<string>): string {
  // A copy of a copy adds to the original's address, not to `about-copy-copy`.
  const base = slug.replace(/-copy(?:-\d+)?$/, "") || slug;
  for (let n = 1; n < 10_000; n++) {
    const suffix = n === 1 ? "-copy" : `-copy-${n}`;
    const stem = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "");
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Ten thousand copies of one page: not a real case, but never loop or return a taken address.
  return `${base.slice(0, SLUG_MAX - 9).replace(/-+$/, "")}-copy-${Date.now() % 100_000_000}`;
}

/** What duplicating answers: the copy's id (to open it), or why it could not be made. */
export type DuplicateResult = { ok: true; id: string } | { ok: false; problems: string[] };
