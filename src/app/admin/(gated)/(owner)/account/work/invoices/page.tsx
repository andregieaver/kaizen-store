import type { Metadata } from "next";

import { OwnerInvoicesView } from "@/components/admin/work/owner-invoices";
import { OwnerWorkStart } from "@/components/admin/work/owner-settings";
import { invoiceListFilter, parseInvoiceListParams } from "@/lib/work-invoice-ui";
import { activeStoreSlug, defaultNewStore, parseStoreParam, scopeStores } from "@/lib/work-owner";
import { requireAccount } from "@/server/auth";
import { getOwnerSettings, listOwnerInvoices, workStoresFor } from "@/server/work-owner";

import { switchActionsFor } from "../owner-page";

export const metadata: Metadata = { title: "Invoices" };

const PAGE_SIZE = 25;

/**
 * The invoices of all the account's stores (D123): drafts, issued, overdue, paid and void, with totals per
 * currency, a store filter, and the place to start a new one (which asks for the store first). The filters are in
 * the address, so the overview's "overdue" and "drafts" lead here.
 */
export default async function OwnerInvoicesPage({ searchParams }: PageProps<"/admin/account/work/invoices">) {
  const account = await requireAccount();
  const { using, off } = await workStoresFor(account);
  if (using.length === 0) {
    const rows = await getOwnerSettings(off);
    return <OwnerWorkStart title="Invoices" rows={rows} actions={switchActionsFor(rows)} />;
  }
  const query = await searchParams;
  const params = parseInvoiceListParams(query);
  const storeSlug = activeStoreSlug(using, parseStoreParam(query));
  const { status, ...filter } = invoiceListFilter(params, PAGE_SIZE);
  const list = await listOwnerInvoices(scopeStores(using, storeSlug), {
    ...filter,
    status: status === "open" ? undefined : status,
  });
  return (
    <OwnerInvoicesView
      stores={using}
      list={list}
      params={params}
      storeSlug={storeSlug}
      defaultStore={defaultNewStore(using, storeSlug)?.slug ?? ""}
    />
  );
}
