import type { Metadata } from "next";

import { SlidersHorizontal } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { adminDate } from "@/lib/admin-date";
import { listOffset, LIST_PAGE_SIZE } from "@/lib/list-page";
import { pageAddress } from "@/components/admin/ui/pager";
import { formatBps, priceLabel } from "@/lib/plans";
import { STORE_BILLINGS, STORE_STATES, storeListFilter, storeListFiltered, storeListQuery } from "@/lib/platform-stores";
import { storeBillingPage, storeListFacts } from "@/server/billing";
import { requirePlatformReader } from "@/server/auth";
import { AdminLink, ButtonLink, Card, Chip, EmptyState, Field, List, ListRow, ListSearch, PageHeader, Pager, RowAmount, RowFact, RowLead, Select } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { BILLING_WORDS } from "@/lib/admin-words/billing";
import { KIT_WORDS } from "@/lib/admin-words/kit";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";

export const metadata: Metadata = { title: "Stores" };

const BASE = "/admin/platform/stores";

/**
 * Every store with its plan, subscription and fee, a hundred a page with the count (code review step 2.10, D847): the store admin's list, a
 * search by the store, its owner or a domain, the store's state as chips and its plan and subscription under Filters, all in one GET form,
 * so each keeps the others and the pager keeps them all. The page builder's sandbox and its funnel are on Access requests.
 */
export default async function PlatformStoresPage({ searchParams }: PageProps<"/admin/platform/stores">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const all = PLATFORM_WORDS[lang];
  const w = all.stores;
  const billingWords = BILLING_WORDS[lang];
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const { page, ...filter } = storeListFilter(await searchParams);
  const kept = storeListQuery(filter);
  const [{ rows: stores, total }, facts] = await Promise.all([
    storeBillingPage({ ...filter, limit: LIST_PAGE_SIZE, offset: listOffset(page) }),
    storeListFacts(),
  ]);
  // A page past the last (stores closed or filtered away, a link kept from before) opens the first.
  if (stores.length === 0 && page > 1) redirect(pageAddress(BASE, kept, 1));
  const filtered = storeListFiltered(filter);
  // The chips: every store, then each state that has a store (or is the one chosen), each with how many the list holds in all.
  const chips = [
    { key: "all", label: w.all, n: facts.counts.all, on: filter.state === null },
    ...STORE_STATES.map((state) => ({ key: state, label: all.storeStatus[state], n: facts.counts[state], on: filter.state === state })),
  ].filter((chip) => chip.key === "all" || chip.n > 0 || chip.on);
  const chip = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-sm";
  const narrowed = Boolean(filter.plan || filter.billing);

  return (
    <>
      <PageHeader
        title={w.title}
        description={w.description}
        actions={
          // The Dream Factory (D409) builds a store in the platform admin's name, from Your stores.
          <ButtonLink href="/admin/stores" size="header">
            {w.dreamLink}
          </ButtonLink>
        }
      />
      <ListSearch
        action={BASE}
        id="store-search"
        value={filter.q}
        label={w.search}
        placeholder={w.searchPlaceholder}
        maxLength={100}
        words={KIT_WORDS[lang].search}
        button="hidden"
        keep={{ state: filter.state }}
        tools={
          // Lisa's step (D847): the plan and the subscription, in the same form, so a chip or the search keeps them.
          <details className="relative">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-pill bg-sunken px-3.5 text-caption text-ink [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal aria-hidden className="size-3.5" />
              {w.filters}
              {narrowed && <span className="size-1.5 rounded-pill bg-brand" aria-hidden />}
            </summary>
            <div className="absolute right-0 z-30 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-panel border border-line bg-card p-3 shadow-[var(--shadow-float)]">
              <Field label={w.plan}>
                {(control) => (
                  <Select name="plan" defaultValue={filter.plan ?? ""} full {...control}>
                    <option value="">{w.anyPlan}</option>
                    <option value="none">{w.noPlan}</option>
                    {facts.plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={w.billing}>
                {(control) => (
                  <Select name="billing" defaultValue={filter.billing ?? ""} full {...control}>
                    <option value="">{w.anyBilling}</option>
                    {STORE_BILLINGS.map((billing) => (
                      <option key={billing} value={billing}>
                        {w.billings[billing]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-body font-medium text-brand-ink">
                {w.apply}
              </button>
            </div>
          </details>
        }
        aside={
          <>
            {/* The store's own state (D171): the form's buttons, each a count of every store the list holds; on a phone a row that scrolls. */}
            <div role="group" aria-label={w.show} className="flex flex-wrap gap-1.5 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4">
              {chips.map((one) => (
                <button
                  key={one.key}
                  type="submit"
                  name="state"
                  value={one.key}
                  aria-pressed={one.on}
                  className={`${chip} ${one.on ? "bg-inverse text-inverse-ink" : "bg-card text-ink-2 hover:text-ink"}`}
                >
                  {one.label} <span className="tabular-nums opacity-80">{one.n}</span>
                </button>
              ))}
            </div>
            {/* The bar's own way back (D845): the empty state below needs none. */}
            {filtered && (
              <AdminLink href={BASE} className="flex min-h-10 items-center px-2 text-sm underline">
                {w.everyStore}
              </AdminLink>
            )}
          </>
        }
      />
      {stores.length === 0 ? (
        <EmptyState title={filter.q ? fillWords(w.noMatch, { q: filter.q }) : filtered ? w.noMatchFilters : w.none} />
      ) : (
        <Card compact>
          {/* Round 63 (D827): on a phone each store is one row of two lines. */}
          <List label={w.title}>
            {stores.map((store) => (
              <ListRow key={store.storeId}>
                <RowLead
                  title={store.name}
                  href={`/admin/platform/stores/${store.slug}`}
                  sub={
                    <>
                      <span className="max-sm:hidden">
                        {store.slug} · {store.ownerEmail ? (store.ownerName ? `${store.ownerName}, ${store.ownerEmail}` : store.ownerEmail) : w.noOwner}
                      </span>
                      <span className="sm:hidden">
                        {store.slug} · {store.planName ?? w.noPlan} · {fillWords(w.aSale, { fee: formatBps(store.feeBps, locale) })}
                      </span>
                    </>
                  }
                />
                <span className="contents max-sm:hidden">
                  <RowFact
                    sub={[
                      store.status ? (billingWords.statuses[store.status] ?? store.status) : null,
                      store.cancelAtPeriodEnd && w.endsAtPeriodEnd,
                      store.mode === "test" && w.testMode,
                      store.currentPeriodEnd && !store.cancelAtPeriodEnd && store.status !== "canceled" && fillWords(w.nextInvoice, { date: adminDate(store, store.currentPeriodEnd, "day", lang) }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {store.planName ? `${store.planName}${store.price ? `, ${priceLabel(store.price.amountMinor, store.price.currency, store.price.interval, billingWords.intervals)}` : ""}` : w.noPlan}
                  </RowFact>
                </span>
                {store.storeStatus !== "active" && (
                  <Chip signal={store.storeStatus === "closed" ? "neutral" : "danger"} dot>
                    {store.storeStatus === "closed" ? w.closed : w.suspended}
                  </Chip>
                )}
                <span className="contents max-sm:hidden">
                  <RowAmount>
                    {fillWords(w.aSale, { fee: formatBps(store.feeBps, locale) })}
                    {store.saleFeeBpsOverride !== null && <span className="block text-caption text-muted">{w.ownFee}</span>}
                  </RowAmount>
                </span>
              </ListRow>
            ))}
          </List>
          <Pager
            words={{ ...KIT_WORDS[lang].pager, shownOf: w.shownOf, previous: w.previous, next: w.next }}
            label={w.title}
            base={BASE}
            query={kept}
            page={page}
            size={LIST_PAGE_SIZE}
            shown={stores.length}
            total={total}
          />
        </Card>
      )}
    </>
  );
}
