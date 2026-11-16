import type { Metadata } from "next";
import { ArrowUpDown, Search, SlidersHorizontal } from "lucide-react";

import { requireFeature } from "@/components/admin/feature-off";
import { CUSTOMERS_FEATURE } from "@/lib/store-nav";
import { moneyByCurrency } from "@/components/admin/customer-bar";
import { CustomerList } from "@/components/admin/customers/customer-list";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { Avatar } from "@/components/avatar";
import { Initials } from "@/components/admin/home/home-parts";
import { memberCan, requirePermission } from "@/server/permissions";
import { avatarFor } from "@/server/avatars";
import { customerCounts, listCustomers, type CustomerShow, type CustomerSort } from "@/server/customer-admin";
import { orderPreviews } from "@/server/home";
import { whenWords } from "@/lib/home";
import { storeTags } from "@/server/segments";
import { tagKey } from "@/lib/order-tags";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { AdminLink, CARD_CLASS, PageHeader } from "@/components/admin/ui";
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
  const all = adminText(lang, "customers");
  const words = all.list;
  const staff = all.staff;
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  // A tag in the address (wave 10 unit C, D366) is read as a key; one the store does not have shows nobody.
  const tag = typeof query.tag === "string" ? tagKey(query.tag) : null;
  const show = SHOWS.find((s) => s === query.show) ?? null;
  const sort = SORTS.find((s) => s === query.sort) ?? "recent";
  const currency = store.markets[0]?.currency ?? "EUR";
  const [customers, tags, counts] = await Promise.all([listCustomers(store.id, { q, tag, show, sort }), storeTags(store.id), customerCounts(store.id, currency)]);
  const previews = await orderPreviews(store.id, customers.flatMap((c) => (c.latestOrderId ? [c.latestOrderId] : [])));
  const linesOf = new Map(previews.map((p) => [p.id, p.lines.map(({ title, picture }) => ({ title, picture }))]));
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const base = `/admin/${store.slug}/customers`;
  const now = new Date();
  const when = adminText(lang, "home").today.when;
  // The last order in words near today ("Today", "3 days ago"), its day and month further back.
  const lastWords = (iso: string) => {
    const days = (now.getTime() - Date.parse(iso)) / 86_400_000;
    if (days < 6) {
      const text = whenWords(iso, now, store.timeZone, when);
      return text.charAt(0).toLocaleUpperCase() + text.slice(1);
    }
    return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: store.timeZone });
  };
  const money = (minor: number) => moneyByCurrency({ [currency]: minor }, locale);
  const hrefWith = (change: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const values: Record<string, string | null> = { q: q || null, tag, show, sort: sort === "recent" ? null : sort, ...change };
    for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
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
        <section aria-label={words.figures.fresh} className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 sm:gap-1.5 sm:px-5 sm:py-4 ${CARD_CLASS}`}>
            <span className="truncate text-[11px] text-muted sm:text-caption">{words.figures.fresh}</span>
            <span className="text-[17px] tracking-tight sm:text-[26px]">{counts.fresh}</span>
          </div>
          <div className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 sm:gap-1.5 sm:px-5 sm:py-4 ${CARD_CLASS}`}>
            <span className="truncate text-[11px] text-muted sm:text-caption">{words.figures.back}</span>
            <span className="text-[17px] tracking-tight sm:text-[26px]">
              {counts.back} <span className="text-[11px] tracking-normal text-muted sm:text-caption">{fillWords(words.figures.backOf, { n: counts.people })}</span>
            </span>
            {counts.back === 0 && <span className="hidden text-caption text-muted sm:block">{words.figures.backHint}</span>}
          </div>
          {counts.averageSpentMinor !== null && (
            <div className={`flex min-w-0 flex-col gap-1 px-3 py-2.5 sm:gap-1.5 sm:px-5 sm:py-4 ${CARD_CLASS}`}>
              <span className="truncate text-[11px] text-muted sm:text-caption">{words.figures.average}</span>
              <span className="truncate text-[17px] tracking-tight tabular-nums sm:text-[26px]">{money(counts.averageSpentMinor)}</span>
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <nav aria-label={words.views.label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-pill bg-card p-1 [scrollbar-width:none]">
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
        <form role="search" action={base} className="flex min-w-[16rem] flex-1 items-center gap-2 rounded-pill bg-card py-1 pr-1.5 pl-4 shadow-[inset_0_0_0_1px_var(--color-edge)]">
          {show && <input type="hidden" name="show" value={show} />}
          {sort !== "recent" && <input type="hidden" name="sort" value={sort} />}
          <Search aria-hidden className="size-4 shrink-0 text-muted" />
          <label className="sr-only" htmlFor="customer-search">
            {words.search}
          </label>
          <input id="customer-search" name="q" type="search" defaultValue={q} placeholder={words.searchPlaceholder} className="min-h-9 min-w-0 flex-1 bg-transparent text-body outline-none" />
          {tags.length > 0 && (
            <details className="relative">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-pill bg-sunken px-3.5 text-caption text-ink [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden className="size-3.5" />
                {words.filters}
                {tag && <span className="size-1.5 rounded-pill bg-brand" aria-hidden />}
              </summary>
              <div className="absolute right-0 z-30 mt-2 flex w-64 flex-col gap-3 rounded-panel border border-line bg-card p-3 shadow-[var(--shadow-float)]">
                <label className="flex flex-col gap-1 text-caption text-muted">
                  {staff.tagLabel}
                  <select name="tag" defaultValue={tag ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-body text-ink">
                    <option value="">{staff.allTags}</option>
                    {tags.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-body font-medium text-brand-ink">
                  {words.searchButton}
                </button>
              </div>
            </details>
          )}
          <button type="submit" className="sr-only">
            {words.searchButton}
          </button>
        </form>
        <MoreMenu label={words.sort[sort]}>
          {SORTS.map((option) => (
            <AdminLink key={option} href={hrefWith({ sort: option === "recent" ? null : option })} aria-current={option === sort ? "true" : undefined} className={`${menuItem} gap-2 aria-[current=true]:font-medium`}>
              {option === sort && <ArrowUpDown aria-hidden className="size-3.5" />}
              {words.sort[option]}
            </AdminLink>
          ))}
        </MoreMenu>
        {filtered && (
          <AdminLink href={hrefWith({ q: null, tag: null })} className="flex min-h-10 items-center px-2 text-body underline">
            {words.showEveryone}
          </AdminLink>
        )}
      </div>

      {customers.length === 0 ? (
        <p className={`p-8 text-center text-body text-muted ${CARD_CLASS}`}>{filtered || show ? words.noMatch : words.none}</p>
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

      {canWrite && customers.length > 0 && (
        <details className={`px-5 py-4 ${CARD_CLASS}`}>
          <summary className="cursor-pointer text-body font-medium">{words.wholeList}</summary>
          <p className="mt-2 text-caption text-muted">{staff.bulk.description}</p>
          <ActionForm action={bulkTagAction.bind(null, store.slug)} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="filterTag" value={tag ?? ""} />
            <label className="flex flex-col gap-1 text-body">
              {staff.bulk.tag}
              <input name="tag" required maxLength={40} className="min-h-10 w-56 rounded-md border border-line bg-card px-3" />
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
