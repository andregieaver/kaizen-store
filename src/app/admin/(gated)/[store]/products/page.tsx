import { AdminLink } from "@/components/admin/ui/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminLink as Link } from "@/components/admin/ui/link";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import type { BulkTools } from "@/components/admin/products-bulk";
import { ProductCatalogue } from "@/components/admin/product-catalogue";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { NeedsContentList, NeedsContentNotice } from "@/components/admin/unit-price-gaps-view";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { ACTIVE_IMPORT_STATUSES } from "@/lib/data-job";
import { LIST_PAGE_SIZE, listPage } from "@/lib/list-page";
import { areaTexts } from "@/lib/admin-area";
import { KIT_WORDS } from "@/lib/admin-words/kit";
import { PRODUCTS_WORDS } from "@/lib/admin-words/products";
import { SCREENS_WORDS } from "@/lib/admin-words/screens";
import { memberCan, requirePermission } from "@/server/permissions";
import { productsListReads } from "@/server/admin-screens";
import { PRODUCT_SHOWS, type ProductShow } from "@/server/product-list";
import { GuideSlot } from "@/components/admin/guide/guide-slots";
import { ButtonLink, EmptyState, ListSearch, PageHeader, Pager } from "@/components/admin/ui";
import { pageAddress } from "@/components/admin/ui/pager";

import { continueBulkAction, matchingAction, previewBulkAction, startBulkAction, undoBatchAction } from "./bulk/actions";

export const metadata: Metadata = { title: "Products" };

type Props = PageProps<"/admin/[store]/products">;

export default async function ProductsPage({ params, searchParams }: Props) {
  const member = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const canWrite = memberCan(member, "products:write");
  const w = PRODUCTS_WORDS[adminLangOf(member.account.adminLocale)].list;
  const menuItem = "flex min-h-10 items-center rounded-panel px-3 text-sm text-ink hover:bg-sunken";
  const c = PRODUCTS_WORDS[adminLangOf(member.account.adminLocale)].catalogue;
  return (
    <div className="flex flex-col gap-6">
      {/* Round 2 (D597): the header's one green action, Lisa's tools in one menu. */}
      <PageHeader
        title={w.title}
        actions={
          <>
            <MoreMenu label={c.more}>
              <Link href={`/admin/${store.slug}/products/export`} className={menuItem}>
                {w.exportLink}
              </Link>
              {canWrite && (
                <Link href={`/admin/${store.slug}/products/import`} className={menuItem}>
                  {w.importLink}
                </Link>
              )}
              <Link href={`/admin/${store.slug}/products/categories`} className={menuItem}>
                {w.categories}
              </Link>
            </MoreMenu>
            <Link href={`/admin/${store.slug}/products/new`} className="max-sm:hidden inline-flex h-11 items-center rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
              + {w.add}
            </Link>
          </>
        }
      />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-card" />}>
        <ProductList storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ProductList({
  storeSlug,
  searchParams,
}: {
  storeSlug: string;
  searchParams: Props["searchParams"];
}) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const canWrite = memberCan(member, "products:write");
  const lang = adminLangOf(member.account.adminLocale);
  const w = PRODUCTS_WORDS[lang].list;
  const c = PRODUCTS_WORDS[lang].catalogue;
  const query = await searchParams;
  // The view (code review 1.13, D834): the chips are the search form's buttons, sent after the view it keeps, so the last one named wins.
  const show = [query.show].flat().reduce<ProductShow>((was, value) => PRODUCT_SHOWS.find((s) => s === value) ?? was, "all");
  const archived = show === "archived";
  const needsFilter = !archived && query.needs === "unit-price";
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const page = listPage(query.page);
  const locale = store.markets[0]?.locale ?? "en";
  const { products, total, counts, needingCount, needing, terms, imports } = await productsListReads(member, { show, q, page, needsFilter, canWrite, locale });
  const base = `/admin/${store.slug}/products`;
  const kept = { show: show === "all" ? undefined : show, q: q || undefined };
  // A page past the last (products archived, a link kept from before) opens the first.
  if (!needsFilter && products.length === 0 && page > 1) redirect(pageAddress(base, kept, 1));
  const openImport = imports.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const bulk: BulkTools | null = terms
    ? {
        preview: previewBulkAction.bind(null, store.slug),
        start: startBulkAction.bind(null, store.slug),
        next: continueBulkAction.bind(null, store.slug),
        matching: matchingAction.bind(null, store.slug),
        undo: undoBatchAction.bind(null, store.slug),
        terms: terms.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        markets: store.markets.map((m) => ({ code: m.code, name: m.name, currency: m.currency })),
      }
    : null;
  const needsHref = `${base}?needs=unit-price`;
  // Nothing in the store's current (or archived) products at all: the first-product card, not a search.
  const none = total === 0 && !q && (show === "all" || archived);
  const chips: { key: ProductShow; label: string; n: number; warn?: boolean }[] = counts
    ? [
        { key: "all", label: c.all, n: counts.all },
        { key: "active", label: c.onSale, n: counts.active },
        { key: "draft", label: c.drafts, n: counts.draft },
        { key: "stock", label: c.needsStock, n: counts.stock, warn: true },
      ]
    : [];
  const chip = "inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-sm";

  const market = store.markets[0];
  return (
    <AdminTextScope texts={areaTexts(lang, { products: PRODUCTS_WORDS })}>
      {!needsFilter && <NeedsContentNotice count={needingCount} href={needsHref} words={SCREENS_WORDS[lang].unitGaps} />}
      {openImport && (
        <p className="rounded-panel bg-sunken p-3 text-sm">
          {fillWords(w.openImport, { name: openImport.inputName ?? w.aFile })}{" "}
          <Link href={`${base}/import/${openImport.id}`} className="underline underline-offset-2">
            {w.continueIt}
          </Link>
          .
        </p>
      )}
      <nav aria-label={w.filters} className="flex gap-2 text-sm">
        <AdminLink
          href={base}
          aria-current={archived || needsFilter ? undefined : "page"}
          className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium"
        >
          {w.current}
        </AdminLink>
        <AdminLink
          href={`${base}?show=archived`}
          aria-current={archived ? "page" : undefined}
          className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium"
        >
          {w.archived}
        </AdminLink>
        {(needingCount > 0 || needsFilter) && (
          <AdminLink
            href={needsHref}
            aria-current={needsFilter ? "page" : undefined}
            className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium"
          >
            {w.needsContent}
          </AdminLink>
        )}
      </nav>
      {needsFilter ? (
        <NeedsContentList products={needing} base={base} words={SCREENS_WORDS[lang].unitGaps} />
      ) : none ? (
        <EmptyState
          title={archived ? w.noArchived : w.none}
          action={
            !archived &&
            canWrite && (
              <ButtonLink kind="main" href={`${base}/new`}>
                {w.addFirst}
              </ButtonLink>
            )
          }
        // No product yet: Guide says what is enough to start (D909).
        after={!archived && <GuideSlot name="hint" place="products" />}
      />
      ) : (
        <>
          {/* On a phone and above the list (round 8, D626): what costs sales, from the figures of every current product. */}
          {counts && counts.soldOut > 0 && (
            <p className="text-body text-ink-2">
              <span className="text-ink">{countWords(counts.soldOut, c.soldOutSentence)}</span>
              {fillWords(c.restSentence, { active: counts.active, drafts: countWords(counts.draft, c.draftCount) })}
            </p>
          )}
          <ProductCatalogue
            slug={store.slug}
            archived={archived}
            locale={locale}
            bulk={bulk}
            total={total}
            filter={{ show, q }}
            empty={
              <EmptyState
                title={q ? fillWords(c.noMatch, { q }) : c.noneShown}
                action={<ButtonLink href={archived ? `${base}?show=archived` : base}>{KIT_WORDS[lang].empty.clearFilters}</ButtonLink>}
              />
            }
            priceHeader={market ? fillWords(store.audience === "businesses" ? w.priceInExclVat : w.priceIn, { market: market.name }) : w.price}
            rows={products.map((p) => ({ id: p.id, title: p.title, status: p.status, image: p.image, variants: p.variants, digitalVariants: p.digitalVariants, stock: p.stock, price: p.price }))}
            toolbar={
              // The kit's search (D834): a GET form over every page, by name or SKU; the views are its buttons, each a count of every current product.
              <ListSearch
                action={base}
                value={q}
                label={c.search}
                placeholder={c.searchPlaceholder}
                maxLength={100}
                words={KIT_WORDS[lang].search}
                button="hidden"
                keep={{ show: kept.show }}
                className="min-w-0 flex-[1_1_16rem]"
                aside={
                  !archived && (
                    <div role="group" aria-label={c.show} className="flex flex-wrap gap-1.5 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4">
                      {chips
                        .filter((one) => one.key === "all" || one.n > 0 || one.key === show)
                        .map((one) => (
                          <button
                            key={one.key}
                            type="submit"
                            name="show"
                            value={one.key}
                            aria-pressed={show === one.key}
                            className={`${chip} shrink-0 ${show === one.key ? "bg-inverse text-inverse-ink" : one.warn ? "bg-warning-soft text-warning-text" : "bg-card text-ink-2 hover:text-ink"}`}
                          >
                            {one.label} <span className="tabular-nums opacity-80">{one.n}</span>
                          </button>
                        ))}
                    </div>
                  )
                }
              />
            }
            pager={<Pager words={KIT_WORDS[lang].pager} label={w.title} base={base} query={kept} page={page} size={LIST_PAGE_SIZE} shown={products.length} total={total} />}
          />
        </>
      )}
    </AdminTextScope>
  );
}
