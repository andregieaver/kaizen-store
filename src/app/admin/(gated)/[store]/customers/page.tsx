import { SelectNav } from "@/components/admin/select-nav";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowUpDown, SlidersHorizontal } from "lucide-react";

import { requireFeature } from "@/components/admin/feature-off";
import { CUSTOMERS_FEATURE } from "@/lib/store-nav";
import { moneyByCurrency } from "@/components/admin/customer-bar";
import { CustomerList } from "@/components/admin/customers/customer-list";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { Avatar } from "@/components/avatar";
import { Initials } from "@/components/admin/home/home-parts";
import { memberCan, requirePermission } from "@/server/permissions";
import { avatarFor } from "@/server/avatars";
import { customerCounts, customerPage, type CustomerShow, type CustomerSort } from "@/server/customer-admin";
import { orderPreviews } from "@/server/home";
import { whenWords } from "@/lib/home";
import { storeTags } from "@/server/segments";
import { tagKey } from "@/lib/order-tags";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { LIST_PAGE_SIZE, listOffset, listPage } from "@/lib/list-page";
import { CUSTOMERS_WORDS } from "@/lib/admin-words/customers";
import { HOME_WORDS } from "@/lib/admin-words/home";
import { KIT_WORDS } from "@/lib/admin-words/kit";
import { AdminLink, ButtonLink, CARD_CLASS, EmptyState, ListSearch, PageHeader, Pager, Select, TextInput } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";

import { bulkTagAction, tagTickedAction } from "./actions";

export const metadata: Metadata = { title: "Customers" };

/** Everyone who has an account or has bought (D35), most recently active first, with a search. */
const SHOWS: readonly CustomerShow[] = ["new", "back", "subscribed"];
const SORTS: readonly CustomerSort[] = ["recent", "orders", "name"];

/**
 * Everyone who has an account or has bought (D35). Round 3 (D603): a sentence on who bought and who came back, three figures, views (all, new,
 * came back, subscribed), one search bar with its filters, an order, rows with pictures of what they bought, and a bar to tag the people ticked.
 */
export default async function CustomersPage({ params, searchParams }: PageProps<"/admin/[store]/customers">) {
  const member = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, CUSTOMERS_FEATURE);
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = CUSTOMERS_WORDS[lang];
  const words = all.list;
  const staff = all.staff;
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  // A tag in the address (wave 10 unit C, D366) is read as a key; one the store does not have shows nobody.
  const tag = typeof query.tag === "string" ? tagKey(query.tag) : null;
  const show = SHOWS.find((s) => s === query.show) ?? null;
  const sort = SORTS.find((s) => s === query.sort) ?? "recent";
  const currency = store.markets[0]?.currency ?? "EUR";
  // A hundred a page, with how many the search finds in all (code review 1.13, D834).
  const page = listPage(query.page);
  const [{ rows: customers, total }, tags, counts] = await Promise.all([
    customerPage(store.id, { q, tag, show, sort, limit: LIST_PAGE_SIZE, offset: listOffset(page) }),
    storeTags(store.id),
    customerCounts(store.id, currency),
  ]);
  const previews = await orderPreviews(store.id, customers.flatMap((c) => (c.latestOrderId ? [c.latestOrderId] : [])));
  const linesOf = new Map(previews.map((p) => [p.id, p.lines.map(({ title, picture }) => ({ title, picture }))]));
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const base = `/admin/${store.slug}/customers`;
  const now = new Date();
  const when = HOME_WORDS[lang].today.when;
  // The last order in words near today ("Today", "3 days ago"), its day and month further back.
  const lastWords = (iso: string) => {
    const days = (now.getTime() - Date.parse(iso)) / 86_400_000;
    if (days < 6) {
      const text = whenWords(iso, now, store.timeZone, when);
      return text.charAt(0).toLocaleUpperCase() + text.slice(1);
    }
    return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: store.timeZone });
  };
  const hrefWith = (change: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const values: Record<string, string | null> = { q: q || null, tag, show, sort: sort === "recent" ? null : sort, ...change };
    for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
  // A page past the last (people tagged off, a link kept from before) opens the first.
  if (customers.length === 0 && page > 1) redirect(hrefWith({}));
  const lead =
    counts.people === 0
      ? words.leadNobody
      : countWords(counts.people, words.lead) +
        (counts.fresh === counts.people ? words.leadAllFresh : counts.fresh > 0 ? countWords(counts.fresh, words.leadFresh) : words.leadNoneFresh) +
        (counts.back > 0 ? countWords(counts.back, words.leadBack) : words.leadNoneBack);
  const views: { show: CustomerShow | null; label: string; count: number }[] = [
    { show: null, label: words.views.all, count: counts.people },
    { show: "new", label: words.views.fresh, count: counts.fresh },
    { show: "back", label: words.views.back, count: counts.back },
    { show: "subscribed", label: words.views.subscribed, count: counts.subscribed },
  ];
  const canWrite = memberCan(member, "customers:write");
  const menuItem = "flex min-h-10 items-center rounded-panel px-3 text-body text-ink hover:bg-sunken";
  const filtered = Boolean(q || tag);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={words.title}
        meta={[lead]}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* The customer files (D165, D366) hold personal data, so only the owner is offered them. */}
            {memberCan(member, "owner") && (
              <MoreMenu label={words.more}>
                <AdminLink href={`${base}/import`} className={menuItem}>
                  {staff.importCustomers}
                </AdminLink>
                <AdminLink href={`${base}/export`} className={menuItem}>
                  {words.export}
                </AdminLink>
              </MoreMenu>
            )}
            {canWrite && (
              <AdminLink href={`${base}/new`} className="inline-flex h-11 items-center rounded-pill bg-brand px-5 text-body font-medium text-brand-ink">
                {staff.addCustomer}
              </AdminLink>
            )}
          </div>
        }
      />

      {counts.people > 0 && (
        // Round 20 (D671): on a phone the three figures share one row, small, so the people are on the first screen.
        // Round 30 (D703): on a phone the three share one card, each number above its words, which wrap rather than cut.
        <section aria-label={words.figures.fresh} className="grid grid-cols-3 gap-2 max-sm:gap-0 max-sm:rounded-card max-sm:bg-card sm:gap-3">
          <div className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 max-sm:flex-col-reverse max-sm:justify-end max-sm:bg-transparent sm:gap-1.5 sm:px-5 sm:py-4 ${CARD_CLASS}`}>
            <span className="text-[11px] text-muted sm:truncate sm:text-caption">{words.figures.fresh}</span>
            <span className="text-[17px] tracking-tight sm:text-[26px]">{counts.fresh}</span>
          </div>
          <div className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 max-sm:flex-col-reverse max-sm:justify-end max-sm:bg-transparent sm:gap-1.5 sm:px-5 sm:py-4 ${CARD_CLASS}`}>
            <span className="text-[11px] text-muted sm:truncate sm:text-caption">{words.figures.back}</span>
            <span className="text-[17px] tracking-tight sm:text-[26px]">
              {counts.back} <span className="text-[11px] tracking-normal text-muted sm:text-caption">{fillWords(words.figures.backOf, { n: counts.people })}</span>
            </span>
            {counts.back === 0 && <span className="hidden text-caption text-muted sm:block">{words.figures.backHint}</span>}
          </div>
          {counts.averageSpentMinor !== null && (
            <div className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 max-sm:flex-col-reverse max-sm:justify-end max-sm:bg-transparent sm:gap-1.5 sm:px-5 sm:py-4 ${CARD_CLASS}`}>
              <span className="text-[11px] text-muted sm:truncate sm:text-caption">{words.figures.average}</span>
              <span className="truncate text-[17px] tracking-tight tabular-nums sm:text-[26px]">{moneyByCurrency({ [currency]: counts.averageSpentMinor }, locale, { whole: true })}</span>
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        {/* Round 30 (D703): on a phone the kinds of customer are one choice beside the sort; the chips from the small breakpoint up. */}
        <SelectNav
          label={words.views.label}
          hideLabel
          className="order-2 flex-1 sm:hidden"
          options={views.map((view) => ({ label: `${view.label} · ${view.count}`, href: hrefWith({ show: view.show }), current: view.show === show }))}
        />
        <nav aria-label={words.views.label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-pill bg-card p-1 [scrollbar-width:none] max-sm:hidden">
          {views.map((view) => (
            <AdminLink
              key={view.label}
              href={hrefWith({ show: view.show })}
              aria-current={view.show === show ? "page" : undefined}
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-pill px-3.5 text-body text-ink-2 hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-card"
            >
              {view.label} · {view.count}
            </AdminLink>
          ))}
        </nav>
        <ListSearch
          action={base}
          id="customer-search"
          value={q}
          placeholder={words.searchPlaceholder}
          words={{ label: words.search, button: words.searchButton }}
          keep={{ show, sort: sort === "recent" ? null : sort }}
          button="hidden"
          className="min-w-[16rem] flex-1 max-sm:order-1 max-sm:basis-full"
          tools={
            tags.length > 0 && (
            <details className="relative">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-pill bg-sunken px-3.5 text-caption text-ink [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden className="size-3.5" />
                {words.filters}
                {tag && <span className="size-1.5 rounded-pill bg-brand" aria-hidden />}
              </summary>
              <div className="absolute right-0 z-30 mt-2 flex w-64 flex-col gap-3 rounded-panel border border-line bg-card p-3 shadow-[var(--shadow-float)]">
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {staff.tagLabel}
                  <Select name="tag" defaultValue={tag ?? ""} className="text-ink">
                    <option value="">{staff.allTags}</option>
                    {tags.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-body font-medium text-brand-ink">
                  {words.searchButton}
                </button>
              </div>
            </details>
            )
          }
        />
        <div className="max-sm:order-3">
        <MoreMenu label={words.sort[sort]}>
          {SORTS.map((option) => (
            <AdminLink key={option} href={hrefWith({ sort: option === "recent" ? null : option })} aria-current={option === sort ? "true" : undefined} className={`${menuItem} gap-2 aria-[current=true]:font-medium`}>
              {option === sort && <ArrowUpDown aria-hidden className="size-3.5" />}
              {words.sort[option]}
            </AdminLink>
          ))}
        </MoreMenu>
        </div>
        {filtered && (
          <AdminLink href={hrefWith({ q: null, tag: null })} className="flex min-h-10 items-center px-2 text-body underline max-sm:order-4">
            {words.showEveryone}
          </AdminLink>
        )}
      </div>

      {customers.length === 0 ? (
        <EmptyState
          title={filtered || show ? words.noMatch : words.none}
          action={
            filtered ? (
              <ButtonLink href={hrefWith({ q: null, tag: null })}>{words.showEveryone}</ButtonLink>
            ) : (
              // The header holds Add customer; a list with nobody yet offers the other way in, the old shop's file (the owner's, D165).
              !show &&
              memberCan(member, "owner") && <ButtonLink href={`${base}/import`}>{staff.importCustomers}</ButtonLink>
            )
          }
        />
      ) : (
        <CustomerList
          base={base}
          tagAction={canWrite ? tagTickedAction.bind(null, store.slug) : null}
          items={customers.map((c) => ({
            key: c.key,
            email: c.email,
            name: c.name,
            avatar: c.avatarPath ? <Avatar avatar={avatarFor(c)} size={40} /> : <Initials name={c.name || c.email} size={40} strong={c.orders > 1} />,
            city: c.city,
            subscribed: c.subscribed,
            orders: c.orders,
            lines: c.latestOrderId ? (linesOf.get(c.latestOrderId) ?? []) : [],
            last: c.lastOrderAt ? lastWords(c.lastOrderAt) : words.noOrder,
            spent: moneyByCurrency(c.spentMinor, locale) || "–",
          }))}
          words={{
            label: words.title,
            columns: words.columns,
            orders: words.orders,
            noOrder: words.noOrder,
            subscribed: words.subscribed,
            tickAll: words.tickAll,
            showAll: words.showAll,
            select: words.select,
            selectDone: words.selectDone,
            tickOne: words.tickOne,
            ticked: words.ticked,
            untick: words.untick,
            tagLabel: words.tagLabel,
            addTag: words.addTag,
            removeTag: words.removeTag,
            morePictures: words.morePictures,
          }}
        />
      )}
      <Pager
        words={KIT_WORDS[lang].pager}
        label={words.title}
        base={base}
        query={{ q: q || undefined, tag: tag ?? undefined, show: show ?? undefined, sort: sort === "recent" ? undefined : sort }}
        page={page}
        size={LIST_PAGE_SIZE}
        shown={customers.length}
        total={total}
      />

      {canWrite && customers.length > 0 && (
        <details className={`px-5 py-4 ${CARD_CLASS}`}>
          <summary className="cursor-pointer text-body font-medium">{words.wholeList}</summary>
          <p className="mt-2 text-caption text-muted">{staff.bulk.description}</p>
          <ActionForm action={bulkTagAction.bind(null, store.slug)} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="filterTag" value={tag ?? ""} />
            <input type="hidden" name="show" value={show ?? ""} />
            <label className="flex flex-col gap-1 text-body">
              {staff.bulk.tag}
              <TextInput name="tag" required maxLength={40} className="w-56" />
            </label>
            <SubmitButton name="mode" value="add">
              {staff.bulk.add}
            </SubmitButton>
            <SubmitButton name="mode" value="remove" variant="secondary">
              {staff.bulk.remove}
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
