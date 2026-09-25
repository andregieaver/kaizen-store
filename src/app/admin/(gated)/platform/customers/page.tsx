import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { SUBSCRIPTION_LABELS } from "@/lib/plans";
import { listPlatformCustomers } from "@/server/platform-customers";

export const metadata: Metadata = { title: "Customers" };

/** Kaizen's customers (D35): the people who run stores, with their stores and plans. */
export default async function PlatformCustomersPage({ searchParams }: PageProps<"/admin/platform/customers">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw : "";
  const customers = await listPlatformCustomers({ q });
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-muted">Everyone who runs a store, with each store&apos;s plan. Newest first.</p>
      </div>
      <form role="search" className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="customer-search">
          Search by name, email or store
        </label>
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by name, email or store"
          className="min-h-10 w-full max-w-sm rounded-md border border-border bg-background px-3 text-sm"
        />
        <button type="submit" className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
          Search
        </button>
        {q && (
          <Link href="/admin/platform/customers" className="flex min-h-10 items-center px-2 text-sm underline">
            Show everyone
          </Link>
        )}
      </form>
      {customers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          {q ? "No customer matches the search." : "No customers yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Customer</th>
                <th scope="col" className="px-4 py-2 font-medium">Stores and plans</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Since</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/admin/platform/customers/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                      {c.name || c.email}
                    </Link>
                    <span className="block text-xs text-muted">
                      {c.name && `${c.email}`}
                      {c.disabled && " · disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <ul className="flex flex-col gap-0.5">
                      {c.stores.map((s) => (
                        <li key={s.slug}>
                          <Link href={`/admin/platform/stores/${s.slug}`} className="underline">
                            {s.name}
                          </Link>{" "}
                          <span className="text-xs text-muted">
                            {s.role} · {s.planName && s.status ? `${s.planName}, ${SUBSCRIPTION_LABELS[s.status] ?? s.status}` : "no plan"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">{date(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
