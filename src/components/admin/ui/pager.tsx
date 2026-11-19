import { fillWords } from "@/lib/admin-fill";

import { AdminLink } from "./link";

/**
 * A list's pager (code review step 1.12, D818; FS2): how many are shown of how many, and links to the pages before and after, which work
 * without a script and keep the address's other query values. Two ways to page: by number (`page`, `size`, `shown`, `total`: "100 of
 * 150", *Next 100*; the Stores, Pages and Articles lists, bloat review step 2.17) or by cursor (`previous` and `next` as addresses, `first`
 * when the way back is to the first page; the Orders list, so a boundary never loses or repeats a row). The words are the kit's
 * (`adminText(lang, "kit").pager`), or a list's own ("Next 50 orders"); `{n}` is the page's size. No state: drawn on the server.
 */

export type PagerWords = { label: string; shownOf: string; previous: string; next: string; first: string };

type Query = Record<string, string | string[] | undefined>;

type ByNumber = {
  words: PagerWords;
  /** The list's address. */
  base: string;
  /** The address's query: its other values are kept, the page's is replaced. */
  query?: Query;
  /** The page shown, from 1. */
  page: number;
  /** How many a page holds. */
  size: number;
  /** How many this page shows. */
  shown: number;
  total: number;
  /** The page's name in the address. */
  param?: string;
};

type ByCursor = {
  /** No count: a list paged by cursor says how many match where it says what it shows. */
  words: Omit<PagerWords, "shownOf">;
  /** The address of the page before, or none on the first page. */
  previous?: string | null;
  /** The way back leads to the first page (the word says so). */
  first?: boolean;
  /** The address of the page after, or none on the last. */
  next?: string | null;
};

export type PagerProps = { label?: string; className?: string } & (ByNumber | (ByCursor & { base?: undefined }));

/** The address of page `to` of a list paged by number: the query's other values kept, page 1 without the parameter. */
export function pageAddress(base: string, query: Query, to: number, param = "page"): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (key !== param && typeof value === "string") params.set(key, value);
  if (to > 1) params.set(param, String(to));
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

const LINK = "underline underline-offset-2 hover:text-ink";

export function Pager(props: PagerProps) {
  const { words, label, className } = props;
  let count: string | null = null;
  let previous: { href: string; text: string } | null = null;
  let next: { href: string; text: string } | null = null;
  if (props.base !== undefined) {
    const { base, query = {}, page, size, shown, total, param = "page" } = props;
    if (page <= 1 && shown >= total) return null;
    count = fillWords(props.words.shownOf, { shown: Math.min((page - 1) * size + shown, total), total });
    if (page > 1) previous = { href: pageAddress(base, query, page - 1, param), text: fillWords(words.previous, { n: size }) };
    if (page * size < total) next = { href: pageAddress(base, query, page + 1, param), text: fillWords(words.next, { n: size }) };
  } else {
    if (props.previous) previous = { href: props.previous, text: props.first ? words.first : words.previous };
    if (props.next) next = { href: props.next, text: words.next };
    if (!previous && !next) return null;
  }
  return (
    <nav aria-label={label ?? words.label} className={["flex flex-wrap items-center gap-4 px-1 pt-3 text-body", className].filter(Boolean).join(" ")}>
      {count && <p className="text-muted">{count}</p>}
      {previous && (
        <AdminLink href={previous.href} rel="prev" className={LINK}>
          {previous.text}
        </AdminLink>
      )}
      {next && (
        <AdminLink href={next.href} rel="next" className={LINK}>
          {next.text}
        </AdminLink>
      )}
    </nav>
  );
}
