import { NextResponse, type NextRequest } from "next/server";

import { EXPORT_PROBLEMS } from "@/lib/invoice-admin";
import { sameSite } from "@/server/chat-route";
import { exportDocuments } from "@/server/invoice-export";
import { checkPermission } from "@/server/permissions";

/**
 * The accountant's CSV of invoices or credit notes (D159, `docs/wave-1b-invoices.md` 2.3). It is a POST from the invoices page's form, for
 * members who may change orders: it holds personal data and writes an `invoice.exported` entry to the activity log, so it is never a link
 * a browser or a crawler could open by itself, and it must come from the admin itself. A refusal goes back to the page with a code the page
 * turns into a fixed sentence; a period with more than the cap of documents is refused, never given cut short, because an accountant must
 * be able to trust that the file is whole. Never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/invoices/export">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "orders:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });

  const form = await request.formData().catch(() => null);
  const text = (name: string) => String(form?.get(name) ?? "").trim();
  const type = text("type") === "credit_notes" ? "credit_notes" : "invoices";
  const back = (problem: keyof typeof EXPORT_PROBLEMS) => {
    const url = new URL(`/admin/${slug}/invoices`, request.url);
    if (type === "credit_notes") url.searchParams.set("tab", "credit-notes");
    url.searchParams.set("export", problem);
    return NextResponse.redirect(url, 303);
  };

  const result = await exportDocuments(member, type, text("from"), text("to"));
  if (!result.ok) return back("period");
  if (result.truncated) return back("too_many");
  return new NextResponse(`\uFEFF${result.csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
