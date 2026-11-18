import { fillWords } from "@/lib/admin-fill";

import { AdminLink } from "./ui";

/**
 * A list's pager (bloat review step 2.17): how many are shown of how many, and the hundred before and after, keeping the address's other
 * query values. The markup and words of the Stores list's (step 0.19), for the Pages and Articles lists of a store and of the platform.
 */
export function ListPager({
  words,
  label,
  base,
  query,
  page,
  size,
  shown,
  total,
}: {
  words: { shownOf: string; next: string; previous: string };
  label: string;
  base: string;
  query: Record<string, string | string[] | undefined>;
  page: number;
  /** How many a page of the list holds. */
  size: number;
  /** How many this page shows. */
  shown: number;
  total: number;
}) {
  const href = (to: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (key !== "page" && typeof value === "string") params.set(key, value);
    if (to > 1) params.set("page", String(to));
    const search = params.toString();
    return search ? `${base}?${search}` : base;
  };
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-4 px-1 pt-3 text-body">
      <p className="text-muted">{fillWords(words.shownOf, { shown: String(Math.min((page - 1) * size + shown, total)), total: String(total) })}</p>
      {page > 1 && (
        <AdminLink href={href(page - 1)} className="underline">
          {words.previous}
        </AdminLink>
      )}
      {page * size < total && (
        <AdminLink href={href(page + 1)} className="underline">
          {words.next}
        </AdminLink>
      )}
    </nav>
  );
}
