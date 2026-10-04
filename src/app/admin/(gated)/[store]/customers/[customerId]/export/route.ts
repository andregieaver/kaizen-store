import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { ExportProblem } from "@/lib/privacy-admin";
import { serialiseExport } from "@/lib/privacy-export";
import { sameSite } from "@/server/chat-route";
import { checkPermission } from "@/server/permissions";
import { staffExport } from "@/server/privacy-admin";

/**
 * The file of everything the store holds about one customer (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 2). A POST from the customer
 * page's own form, for members who may change customers: it is personal data and writes `customer.data_exported` (counts and ids, never an email
 * or a name), so it is never a link a browser or a crawler could open by itself, and it must come from the admin. A refusal goes back to the
 * page with a code the page turns into a fixed sentence. The file is downloaded, never emailed; never cached.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/customers/[customerId]/export">) {
  const { store: slug, customerId } = await params;
  const member = await checkPermission(slug, "customers:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });

  const form = await request.formData().catch(() => null);
  const requestField = String(form?.get("request") ?? "").trim();
  const requestId = z.uuid().safeParse(requestField).success ? requestField : null;
  const back = (problem: ExportProblem) => {
    const url = new URL(`/admin/${slug}/${requestId ? `privacy/${requestId}` : `customers/${customerId}`}`, request.url);
    url.searchParams.set("export", problem);
    return NextResponse.redirect(url, 303);
  };
  if (!z.uuid().safeParse(customerId).success) return back("not_found");

  const result = await staffExport({ storeId: member.store.id, accountId: member.account.id, requestId }, customerId);
  if (!result.ok) return back(result.problem);
  return new NextResponse(serialiseExport(result.file), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
