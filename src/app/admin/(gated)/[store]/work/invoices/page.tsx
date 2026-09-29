import type { Metadata } from "next";

import { InvoicesListView } from "@/components/admin/work/invoices-list";
import { WorkOff } from "@/components/admin/work/work-off";
import { invoiceListFilter, parseInvoiceListParams } from "@/lib/work-invoice-ui";
import { requireMember } from "@/server/auth";
import { listClients } from "@/server/work";
import { newInvoiceChoices } from "@/server/work-invoice-screens";
import { listWorkInvoices } from "@/server/work-invoices";

export const metadata: Metadata = { title: "Invoices" };

const PAGE_SIZE = 25;

/**
 * Work's invoices (docs/work.md 5.2): drafts, issued, overdue, paid and void, filtered by client, issue date and a
 * search, and the place to start a new one. The filters are in the address (`?show=overdue`, which the overview
 * links to).
 */
export default async function WorkInvoicesPage({ params, searchParams }: PageProps<"/admin/[store]/work/invoices">) {
  const { store } = await requireMember((await params).store);
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Invoices" />;
  const search = await searchParams;
  const query = parseInvoiceListParams(search);
  const [list, clients, choices] = await Promise.all([
    listWorkInvoices(store.id, invoiceListFilter(query, PAGE_SIZE)),
    listClients(store.id, { archived: "all" }),
    newInvoiceChoices(store.id),
  ]);
  return (
    <InvoicesListView
      storeSlug={store.slug}
      locale={store.markets[0]?.locale ?? "en"}
      list={list}
      params={query}
      clients={clients.map((client) => ({ id: client.id, name: client.name }))}
      choices={choices}
      openNew={search.new === "1"}
    />
  );
}
