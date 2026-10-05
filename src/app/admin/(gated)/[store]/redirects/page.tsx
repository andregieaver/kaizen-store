import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { RedirectForm } from "@/components/admin/redirects/redirect-form";
import { RedirectTable } from "@/components/admin/redirects/redirect-table";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { card, field, hint, primary, secondary } from "@/components/admin/data/ui";
import { FILTER_CHOICES, emptyListWords, listHref, manualCountWords, pageOf, redirectPaths } from "@/lib/redirect-admin";
import { redirectSentences } from "@/lib/redirects";
import { memberCan, requirePermission } from "@/server/permissions";
import { REDIRECT_FILTERS, listRedirects, type RedirectFilter } from "@/server/redirects";

import { checkRedirectAction, deleteRedirectsAction, saveRedirectAction } from "./actions";

export const metadata: Metadata = { title: "Redirects" };

type Props = PageProps<"/admin/[store]/redirects">;

const first = (value: string | string[] | undefined): string => (typeof value === "string" ? value : "");

/**
 * The redirect manager (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2): the store's redirects, newest first, with a search, a kind filter and the
 * count against the limit; a form to add one; and edit and delete on each row. Kaizen makes a redirect itself when a product's, category's or tag's address
 * changes; pages and articles keep theirs (shown read only). Needs the right to read the website; changing needs the right to change it.
 */
export default async function RedirectsPage({ params, searchParams }: Props) {
  const { store } = await requirePermission((await params).store, "website:read");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead
        slug={store.slug}
        active="list"
        title="Redirects"
        intro={`When an address on ${store.name} moves, a redirect sends shoppers and search engines to the new one, in every country and language. Kaizen makes one itself when a product, category or tag changes its address. Here you add your own, for example for an old shop's addresses, and see how often each is used.`}
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "website:read");
  const { store } = member;
  const query = await searchParams;
  const q = first(query.q).slice(0, 200);
  const rawFilter = first(query.filter);
  const filter: RedirectFilter = (REDIRECT_FILTERS as readonly string[]).includes(rawFilter) ? (rawFilter as RedirectFilter) : "all";
  const canWrite = memberCan(member, "website:write");
  const list = await listRedirects(member, { q, filter, page: pageOf(first(query.page)) });
  const base = redirectPaths(store.slug).list;
  const actions = {
    check: checkRedirectAction.bind(null, store.slug),
    save: saveRedirectAction.bind(null, store.slug),
    remove: deleteRedirectsAction.bind(null, store.slug),
  };
  return (
    <>
      <p className={`${card} !p-3 text-sm`}>{redirectSentences.permanent}</p>
      {canWrite && (
        <section aria-labelledby="add-redirect" className="flex flex-col gap-2">
          <h2 id="add-redirect" className="text-base font-semibold">
            Add a redirect
          </h2>
          <RedirectForm actions={actions} />
          <p className={hint}>
            Many addresses at once?{" "}
            <Link href={redirectPaths(store.slug).import} className="underline underline-offset-2">
              Import a CSV file
            </Link>
            . Not sure which addresses are broken?{" "}
            <Link href={redirectPaths(store.slug).report} className="underline underline-offset-2">
              See the pages shoppers could not find
            </Link>
            .
          </p>
        </section>
      )}
      <section aria-labelledby="all-redirects" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="all-redirects" className="text-base font-semibold">
            Your redirects
          </h2>
          <p className="text-sm text-muted">{manualCountWords(list.manual, list.limit)}</p>
        </div>
        <form method="get" action={base} className="flex flex-wrap items-end gap-2" role="search" aria-label="Search the redirects">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor="redirect-q" className="text-sm font-medium">
              Search
            </label>
            <input id="redirect-q" name="q" defaultValue={q} placeholder="An old or a new address" autoComplete="off" className={`${field} font-mono`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="redirect-filter" className="text-sm font-medium">
              Kind
            </label>
            <select id="redirect-filter" name="filter" defaultValue={filter} className={field}>
              {FILTER_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={primary}>
            Search
          </button>
          {(q !== "" || filter !== "all") && (
            <Link href={base} className={secondary}>
              Clear
            </Link>
          )}
        </form>
        {list.rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm">{emptyListWords(q, filter)}</p>
        ) : (
          <RedirectTable rows={list.rows} timeZone={store.timeZone} actions={actions} canWrite={canWrite} />
        )}
        {list.pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between text-sm">
            {list.page > 1 ? (
              <Link href={listHref(base, { q, filter, page: list.page - 1 })} className="underline underline-offset-2">
                Newer redirects
              </Link>
            ) : (
              <span />
            )}
            <span className={hint}>
              Page {list.page} of {list.pages}, {list.total.toLocaleString("en-GB")} redirects
            </span>
            {list.page < list.pages ? (
              <Link href={listHref(base, { q, filter, page: list.page + 1 })} className="underline underline-offset-2">
                Older redirects
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
        <p className={hint}>
          {redirectSentences.atLeast} A redirect that was deleted may keep working in a browser that has seen it.
        </p>
      </section>
    </>
  );
}
