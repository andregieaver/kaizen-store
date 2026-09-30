import type { Metadata } from "next";

import { OwnerReportView } from "@/components/admin/work/owner-report";
import { OwnerWorkStart } from "@/components/admin/work/owner-settings";
import { activeStoreSlug, parseOwnerReportParams, parseStoreParam, scopeStores } from "@/lib/work-owner";
import { requireAccount } from "@/server/auth";
import { getOwnerReport, getOwnerSettings, workStoresFor } from "@/server/work-owner";

import { switchActionsFor } from "../owner-page";

export const metadata: Metadata = { title: "Reports" };

/**
 * The combined report (D123): a period (presets worked out on each store's own day, or custom days), by client or
 * by assignment, for all the account's stores or one. Rows are each store's own (`getPeriodReport()`), the totals
 * are per currency. The settings are in the address, so a view can be linked to and downloaded (`reports/csv`).
 */
export default async function OwnerReportsPage({ searchParams }: PageProps<"/admin/account/work/reports">) {
  const account = await requireAccount();
  const { using, off } = await workStoresFor(account);
  if (using.length === 0) {
    const rows = await getOwnerSettings(off);
    return <OwnerWorkStart title="Reports" rows={rows} actions={switchActionsFor(rows)} />;
  }
  const query = await searchParams;
  const storeSlug = activeStoreSlug(using, parseStoreParam(query));
  const scoped = scopeStores(using, storeSlug);
  const { head, byStore } = parseOwnerReportParams(query, scoped);
  const report = await getOwnerReport(scoped, byStore);
  return <OwnerReportView stores={using} params={head} report={report} storeSlug={storeSlug} />;
}
