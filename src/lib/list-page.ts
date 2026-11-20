/**
 * One way to page an admin list (code review step 1.13, D834; finding FS2): a hundred rows a page, by number, with the count of every row the
 * list's filters match, drawn by the kit's `Pager` ("100 of 150", *Next 100*) with links that keep the address's other values. A list pages by
 * cursor only where rows keep coming in while it is read (Orders, D818), so a boundary never loses or repeats one.
 */
export const LIST_PAGE_SIZE = 100;

/** The page an address asks for, from 1: anything else (none, 0, a fraction, a word, past 10,000) is the first. */
export function listPage(value: string | string[] | undefined): number {
  const text = Array.isArray(value) ? value[0] : value;
  const n = text && /^\d{1,5}$/.test(text) ? Number(text) : 1;
  return n >= 1 && n <= 10_000 ? n : 1;
}

/** How many rows come before page `page`. */
export const listOffset = (page: number, size: number = LIST_PAGE_SIZE): number => (Math.max(1, page) - 1) * size;
