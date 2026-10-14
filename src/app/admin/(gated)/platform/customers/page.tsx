import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Avatar } from "@/components/avatar";
import { SUBSCRIPTION_LABELS } from "@/lib/plans";
import { listPlatformCustomers } from "@/server/platform-customers";
import { requirePlatformAdmin } from "@/server/auth";
import { avatarFor } from "@/server/avatars";
import { Card, List, ListRow, PageHeader, RowDate, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Customers" };

/** Kaizen's customers (D35): the people who run stores, with their stores and plans. */
export default async function PlatformCustomersPage({ searchParams }: PageProps<"/admin/platform/customers">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw : "";
  const customers = await listPlatformCustomers({ q });
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Customers" description={<>Everyone who runs a store, with each store&apos;s plan. Newest first.</>} />
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
          className="min-h-10 w-full max-w-sm rounded-md border border-line bg-card px-3 text-sm"
        />
        <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          Search
        </button>
        {q && (
          <Link href="/admin/platform/customers" className="flex min-h-10 items-center px-2 text-sm underline">
            Show everyone
          </Link>
        )}
      </form>
      {customers.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
          {q ? "No customer matches the search." : "No customers yet."}
        </p>
      ) : (
        <Card compact>
          <List label="Customers">
            {customers.map((c) => (
              <ListRow key={c.id}>
                <RowLead
                  avatar={<Avatar avatar={avatarFor(c)} size={32} />}
                  title={c.name || c.email}
                  href={`/admin/platform/customers/${c.id}`}
                  sub={
                    <>
                      {c.name && `${c.email}`}
                      {c.disabled && " · disabled"}
                    </>
                  }
                />
                <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5 text-body">
                  {c.stores.map((s) => (
                    <span key={s.slug}>
                      <Link href={`/admin/platform/stores/${s.slug}`} className="text-ink underline-offset-2 hover:underline">
                        {s.name}
                      </Link>{" "}
                      <span className="text-caption text-muted">
                        {s.role} · {s.planName && s.status ? `${s.planName}, ${SUBSCRIPTION_LABELS[s.status] ?? s.status}` : "no plan"}
                      </span>
                    </span>
                  ))}
                </span>
                <RowDate>Since {date(c.createdAt)}</RowDate>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
