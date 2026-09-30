import { notFound } from "next/navigation";

import { withBom, CSV_CONTENT_TYPE } from "@/lib/work-csv";
import {
  activeStoreSlug,
  ownerReportFileName,
  ownerReportToCsv,
  parseOwnerReportParams,
  parseStoreParam,
  scopeStores,
} from "@/lib/work-owner";
import { requireAccount } from "@/server/auth";
import { getOwnerReport, workStoresFor } from "@/server/work-owner";

/**
 * The combined Work report as a spreadsheet file (D123), with the settings of the reports page in the address
 * (`?period=last_month&by=assignment&store=acme`). Only stores the account belongs to are in it. Text goes through
 * `toCsv()` (formula-safe), amounts are plain decimals, there is a store column and a total per currency, and the
 * file starts with the byte order mark Excel needs for UTF-8.
 */
export async function GET(request: Request) {
  const account = await requireAccount();
  const { using } = await workStoresFor(account);
  if (using.length === 0) notFound();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const storeSlug = activeStoreSlug(using, parseStoreParam(query));
  const scoped = scopeStores(using, storeSlug);
  const { byStore } = parseOwnerReportParams(query, scoped);
  const report = await getOwnerReport(scoped, byStore);
  return new Response(withBom(ownerReportToCsv(report)), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${ownerReportFileName(report, storeSlug)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
