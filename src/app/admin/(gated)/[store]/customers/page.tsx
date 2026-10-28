import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { accountLabel, moneyByCurrency } from "@/components/admin/customer-bar";
import { Avatar } from "@/components/avatar";
import { memberCan, requirePermission } from "@/server/permissions";
import { avatarFor } from "@/server/avatars";
import { listCustomers } from "@/server/customer-admin";
import { storeTags } from "@/server/segments";
import { tagKey } from "@/lib/order-tags";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { featureOn } from "@/lib/store-features";
import { Card, CARD_CLASS, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Customers" };

/** Everyone who has an account or has bought (D35), most recently active first, with a search. */
export default async function CustomersPage({ params, searchParams }: PageProps<"/admin/[store]/customers">) {
  const member = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const all = adminText(adminLangOf(member.account.adminLocale), "customers");
  const words = all.list;
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  // A tag in the address (wave 10 unit C, D366) is read as a key; one the store does not have shows nobody.
  const tag = typeof query.tag === "string" ? tagKey(query.tag) : null;
  const [customers, tags] = await Promise.all([listCustomers(store.id, { q, tag }), storeTags(store.id)]);
  const staff = all.staff;
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const base = `/admin/${store.slug}/customers`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={words.title}
          description={words.description}
        />
        <div className="flex flex-wrap gap-2">
          {/* The customer files (D165, D366) hold personal data, so only the owner is offered them. */}
          {memberCan(member, "owner") && (
            <>
              <Link href={`${base}/import`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium">
                {staff.importCustomers}
              </Link>
              <Link href={`${base}/export`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium">
                {words.export}
              </Link>
            </>
          )}
          {memberCan(member, "customers:write") && (
            <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
              {staff.addCustomer}
            </Link>
          )}
        </div>
      </div>
      <form role="search" className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="customer-search">
          {words.search}
        </label>
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={words.search}
          className="min-h-10 w-full max-w-sm rounded-md border border-line bg-card px-3 text-sm"
        />
        {tags.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">{staff.tagLabel}</span>
            <select name="tag" defaultValue={tag ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3">
              <option value="">{staff.allTags}</option>
              {tags.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          {words.searchButton}
        </button>
        {(q || tag) && (
          <Link href={base} className="flex min-h-10 items-center px-2 text-sm underline">
            {words.showEveryone}
          </Link>
        )}
      </form>

      {customers.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {q || tag ? words.noMatch : words.none}
        </p>
      ) : (
        <Card compact>
          <List label={words.title}>
            {customers.map((c) => (
              <ListRow key={c.key} href={`${base}/${c.key}`}>
                <RowLead
                  avatar={<Avatar avatar={avatarFor(c)} size={32} />}
                  title={c.name || c.email}
                  sub={
                    <>
                      {c.name && `${c.email} · `}
                      {accountLabel(c.account, all.account)}
                    </>
                  }
                />
                <RowFact
                  sub={
                    c.liveSubscriptions > 0 && featureOn(store, "subscriptions")
                      ? countWords(c.liveSubscriptions, words.subscriptions)
                      : undefined
                  }
                >
                  {countWords(c.orders, words.orders)}
                </RowFact>
                <RowFact className="hidden sm:block" sub={fillWords(words.since, { date: date(c.since) })}>
                  {c.lastOrderAt ? fillWords(words.lastOrder, { date: date(c.lastOrderAt) }) : words.noOrder}
                </RowFact>
                <RowAmount>{moneyByCurrency(c.spentMinor, locale) || "–"}</RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
