import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { RedirectForm } from "@/components/admin/redirects/redirect-form";
import { RedirectTable } from "@/components/admin/redirects/redirect-table";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { card, hint, primary, secondary } from "@/components/admin/data/ui";
import { Field, Select, TextInput } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { emptyListWords, filterChoices, listHref, manualCountWords, pageOf, redirectPaths } from "@/lib/redirect-admin";
import { areaTexts } from "@/lib/admin-area";
import { REDIRECTS_WORDS } from "@/lib/admin-words/redirects";
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
  const { store, account } = await requirePermission((await params).store, "website:read");
  const w = REDIRECTS_WORDS[adminLangOf(account.adminLocale)];
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead slug={store.slug} active="list" title={w.list.title} intro={
          <>
            <span className="sm:hidden">{w.list.phone.lead}</span>
            <span className="max-sm:hidden">{fillWords(w.list.intro, { store: store.name })}</span>
          </>
        } words={w} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "website:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = REDIRECTS_WORDS[lang];
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const l = w.list;
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
    <AdminTextScope texts={areaTexts(lang, { redirects: REDIRECTS_WORDS })}>
      {/* Round 47 (D755): on a phone the warning is the page's last line, adding a redirect a row, and the import a row beside it. */}
      <p className={`${card} !p-3 text-sm max-sm:hidden`}>{w.sentences.permanent}</p>
      {canWrite && (
        <section aria-labelledby="add-redirect" className="flex flex-col gap-2">
          <h2 id="add-redirect" className="text-title text-ink max-sm:sr-only">
            {l.add}
          </h2>
          <PhoneRows>
            <PhoneRow flat title={l.add} sub={l.phone.addSub} change={l.phone.open} done={l.phone.close}>
              <RedirectForm actions={actions} />
            </PhoneRow>
            <Link href={redirectPaths(store.slug).import} className="flex min-h-14 items-center justify-between gap-3 bg-card px-4 py-2 sm:hidden">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body text-ink">{l.manyAtOnce}</span>
                <span className="text-caption text-ink-2">{l.importLink}</span>
              </span>
            </Link>
          </PhoneRows>
          <p className={`${hint} max-sm:hidden`}>
            {l.manyAtOnce}{" "}
            <Link href={redirectPaths(store.slug).import} className="underline underline-offset-2">
              {l.importLink}
            </Link>
            . {l.notSure}{" "}
            <Link href={redirectPaths(store.slug).report} className="underline underline-offset-2">
              {l.reportLink}
            </Link>
            .
          </p>
        </section>
      )}
      <section aria-labelledby="all-redirects" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="all-redirects" className="text-title text-ink">
            {l.yours}
          </h2>
          <p className="text-sm text-muted">{manualCountWords(list.manual, list.limit, w, locale)}</p>
        </div>
        <form
          method="get"
          action={base}
          className={`flex flex-wrap items-end gap-2 ${list.rows.length === 0 && q === "" && filter === "all" ? "max-sm:hidden" : ""}`}
          role="search"
          aria-label={l.searchRegion}
        >
          <Field label={l.searchLabel} id="redirect-q" className="min-w-48 flex-1">
            {(control) => <TextInput {...control} name="q" defaultValue={q} placeholder={l.searchPlaceholder} autoComplete="off" className="font-mono" />}
          </Field>
          <Field label={l.kind} id="redirect-filter">
            {(control) => (
              <Select {...control} name="filter" defaultValue={filter}>
                {filterChoices(w).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button type="submit" className={primary}>
            {l.search}
          </button>
          {(q !== "" || filter !== "all") && (
            <Link href={base} className={secondary}>
              {l.clear}
            </Link>
          )}
        </form>
        {list.rows.length === 0 ? (
          <p className="rounded-panel bg-sunken p-6 text-center text-sm max-sm:bg-transparent max-sm:p-0 max-sm:text-left max-sm:text-muted">{emptyListWords(q, filter, w)}</p>
        ) : (
          <RedirectTable rows={list.rows} timeZone={store.timeZone} actions={actions} canWrite={canWrite} />
        )}
        {list.pages > 1 && (
          <nav aria-label={l.pagesNav} className="flex items-center justify-between text-sm">
            {list.page > 1 ? (
              <Link href={listHref(base, { q, filter, page: list.page - 1 })} className="underline underline-offset-2">
                {l.newer}
              </Link>
            ) : (
              <span />
            )}
            <span className={hint}>
              {fillWords(l.pageOfTotal, { page: list.page, pages: list.pages, total: list.total.toLocaleString(locale) })}
            </span>
            {list.page < list.pages ? (
              <Link href={listHref(base, { q, filter, page: list.page + 1 })} className="underline underline-offset-2">
                {l.older}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
        <p className={`${hint} sm:hidden`}>{l.phone.permanent}</p>
        <p className={`${hint} max-sm:hidden`}>
          {w.sentences.atLeast} {l.deletedKeepsWorking}
        </p>
      </section>
    </AdminTextScope>
  );
}
