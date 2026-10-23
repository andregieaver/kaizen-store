import { notFound } from "next/navigation";

import { writeCsv, type Cell } from "@/lib/csv";
import { USAGE_METRIC_IDS } from "@/lib/usage-metrics";
import { usageMonth } from "@/lib/usage-month";
import { getAccount } from "@/server/auth";
import { platformUsage } from "@/server/usage";

/** The platform's month of usage as CSV (D314): one row per store, raw numbers in each metric's unit (bytes, counts, micro-dollars). */
export async function GET(request: Request) {
  const account = await getAccount();
  if (!account?.platformAdmin) notFound();
  const month = usageMonth(new URL(request.url).searchParams.get("month"));
  const rows = await platformUsage(month);
  const table: Cell[][] = [
    ["store", "slug", "plan", "status", ...USAGE_METRIC_IDS, "estimated"],
    ...rows.map((r) => [r.name ?? "Kaizena Flow", r.slug ?? "", r.plan ?? "", r.status ?? "", ...USAGE_METRIC_IDS.map((m) => r.values[m] ?? null), r.estimated ? "yes" : "no"]),
  ];
  return new Response(writeCsv(table), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="usage-${month}.csv"`, "Cache-Control": "no-store" },
  });
}
