import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { accountLabel, moneyByCurrency } from "@/components/admin/customer-bar";
import { Avatar } from "@/components/avatar";
import { memberCan, requirePermission } from "@/server/permissions";
import { avatarFor } from "@/server/avatars";
import { listCustomers } from "@/server/customer-admin";
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
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw : "";
  const customers = await listCustomers(store.id, { q });
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const base = `/admin/${store.slug}/customers`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Customers"
          description={<>Everyone with an account or a paid order, one per email. Guests who bought without an account are here too.</>}
        />
        {/* The customer file (D165) holds personal data, so only the owner is offered it. */}
        {memberCan(member, "owner") && (
          <Link href={`${base}/export`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium">
            Export
          </Link>
        )}
      </div>
      <form role="search" className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="customer-search">
          Search by name or email
        </label>
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by name or email"
          className="min-h-10 w-full max-w-sm rounded-md border border-line bg-card px-3 text-sm"
        />
        <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          Search
        </button>
        {q && (
          <Link href={base} className="flex min-h-10 items-center px-2 text-sm underline">
            Show everyone
          </Link>
        )}
      </form>

      {customers.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {q ? "No customer matches the search." : "No customers yet. They show here once someone signs up or buys."}
        </p>
      ) : (
        <Card compact>
          <List label="Customers">
            {customers.map((c) => (
              <ListRow key={c.key} href={`${base}/${c.key}`}>
                <RowLead
                  avatar={<Avatar avatar={avatarFor(c)} size={32} />}
                  title={c.name || c.email}
                  sub={
                    <>
                      {c.name && `${c.email} · `}
                      {accountLabel(c.account)}
                    </>
                  }
                />
                <RowFact
                  sub={
                    c.liveSubscriptions > 0 && featureOn(store, "subscriptions")
                      ? c.liveSubscriptions === 1
                        ? "1 subscription"
                        : `${c.liveSubscriptions} subscriptions`
                      : undefined
                  }
                >
                  {c.orders === 1 ? "1 order" : `${c.orders} orders`}
                </RowFact>
                <RowFact className="hidden sm:block" sub={`Customer since ${date(c.since)}`}>
                  {c.lastOrderAt ? `Last order ${date(c.lastOrderAt)}` : "No order yet"}
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
