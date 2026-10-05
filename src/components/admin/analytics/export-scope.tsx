"use client";

import { createContext, useContext, type ReactNode } from "react";

import { ANALYTICS_TABLES, downloadLabel, OWNER_ONLY_TABLES } from "@/lib/analytics-export";

/**
 * The Download CSV button of the analytics tables (D165, `docs/wave-2-data.md` 2.8). A page wraps what it draws in `<ExportScope>` with the
 * store's admin address and the page's own address parameters (`queryText()`: the period, the comparison, the sort); every table and chart
 * with an `exportId` then draws `<ExportButton>`, a small POST form to `{base}/analytics/export` carrying the table's id and those parameters,
 * so the file is the table as the page shows it for that period and comparison. It is a POST, never a link: an export is written to the activity
 * log, so a crawler or a prefetch must not be able to make one, and the route answers 404 to a member without `analytics:write`. Without a scope
 * (a table drawn on its own, in a test) no button is drawn.
 */

type Scope = { action: string; query: string; owner: boolean; canExport: boolean };

const ExportContext = createContext<Scope | null>(null);

/**
 * `canExport` is whether the member holds `analytics:write` (a member who may only read sees no button, as the VAT page shows its note), and
 * `owner` whether they hold the owner role: a table that lists people or what only the owner enters (`OWNER_ONLY_TABLES`) is the owner's to download.
 */
export function ExportScope({ base, query, owner, canExport, children }: { base: string; query: string; owner: boolean; canExport: boolean; children: ReactNode }) {
  return <ExportContext.Provider value={{ action: `${base}/analytics/export`, query, owner, canExport }}>{children}</ExportContext.Provider>;
}

export type LeftOut = { orders: number; currencies: readonly string[] };

/** One table's download: the label repeats what the page leaves out (a currency with no rate), so the file never states more than the page does. */
export function ExportButton({ exportId, leftOut }: { exportId: string; leftOut?: LeftOut | null }) {
  const scope = useContext(ExportContext);
  if (!scope || !scope.canExport || (OWNER_ONLY_TABLES.has(exportId) && !scope.owner)) return null;
  const label = downloadLabel(leftOut ?? { orders: 0, currencies: [] });
  const caption = ANALYTICS_TABLES[exportId]?.caption;
  return (
    <form method="post" action={scope.action} className="inline-flex" data-export-form={exportId}>
      <input type="hidden" name="table" value={exportId} />
      <input type="hidden" name="query" value={scope.query} />
      <button type="submit" className="text-xs font-medium text-(--brand-text) underline-offset-2 hover:underline">
        {label}
        {caption ? <span className="sr-only">{` for: ${caption}`}</span> : null}
      </button>
    </form>
  );
}
