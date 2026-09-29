import { notFound } from "next/navigation";

import { CSV_CONTENT_TYPE, csvFileName, paymentsToCsv, withBom } from "@/lib/work-csv";
import { isDay } from "@/lib/work-dates";
import { audit, requireMember } from "@/server/auth";
import { paymentRegister } from "@/server/work-exports";

/**
 * The payments received on Work invoices as a spreadsheet file (WP7b), by the day they were received, optionally
 * between `?from=` and `?to=` (days as YYYY-MM-DD; anything else is left out). Reversals and refunds are negative
 * amounts. For owners and admins of a store with Work on; anyone else gets a 404. The download is logged.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/work/payments/export">) {
  const { store: slug } = await params;
  const { store, account } = await requireMember(slug);
  if (!store.workOn) notFound();
  const search = new URL(request.url).searchParams;
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const rows = await paymentRegister(store.id, { from: isDay(from) ? from : undefined, to: isDay(to) ? to : undefined });
  await audit(account.id, store.id, "work.payments_exported", { rows: rows.length });
  return new Response(withBom(paymentsToCsv(rows)), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${csvFileName(store.slug, "payments", isDay(from) ? from : "", isDay(to) ? to : "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
