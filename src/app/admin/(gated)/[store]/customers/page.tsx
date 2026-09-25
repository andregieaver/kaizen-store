import type { Metadata } from "next";
import Link from "next/link";

import { accountLabel, moneyByCurrency } from "@/components/admin/customer-bar";
import { requireMember } from "@/server/auth";
import { listCustomers } from "@/server/customer-admin";

export const metadata: Metadata = { title: "Customers" };

/** Everyone who has an account or has bought (D35), most recently active first, with a search. */
export default async function CustomersPage({ params, searchParams }: PageProps<"/admin/[store]/customers">) {
  const { store } = await requireMember((await params).store);
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw : "";
  const customers = await listCustomers(store.id, { q });
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const base = `/admin/${store.slug}/customers`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-muted">
          Everyone with an account or a paid order, one per email. Guests who bought without an account are here too.
        </p>
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
          className="min-h-10 w-full max-w-sm rounded-md border border-border bg-background px-3 text-sm"
        />
        <button type="submit" className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
          Search
        </button>
        {q && (
          <Link href={base} className="flex min-h-10 items-center px-2 text-sm underline">
            Show everyone
          </Link>
        )}
      </form>

      {customers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          {q ? "No customer matches the search." : "No customers yet. They show here once someone signs up or buys."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Customer</th>
                <th scope="col" className="px-4 py-2 font-medium">Orders</th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Spent</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Last order</th>
                <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">Customer since</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.key} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/${c.key}`} className="font-medium underline-offset-2 hover:underline">
                      {c.name || c.email}
                    </Link>
                    <span className="block text-xs text-muted">
                      {c.name && `${c.email} · `}
                      {accountLabel(c.account)}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {c.orders}
                    {c.liveSubscriptions > 0 && (
                      <span className="block text-xs text-muted">
                        {c.liveSubscriptions === 1 ? "1 subscription" : `${c.liveSubscriptions} subscriptions`}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2 md:table-cell">{moneyByCurrency(c.spentMinor, locale) || "–"}</td>
                  <td className="hidden px-4 py-2 sm:table-cell">{c.lastOrderAt ? date(c.lastOrderAt) : "–"}</td>
                  <td className="hidden px-4 py-2 lg:table-cell">{date(c.since)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
