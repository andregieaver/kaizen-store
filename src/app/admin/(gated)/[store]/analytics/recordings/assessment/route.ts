import { connection, NextResponse } from "next/server";

import { adminLangOf } from "@/lib/admin-lang";
import { todayIn } from "@/lib/analytics-period";
import { assessmentFileName, assessmentHtml } from "@/lib/recording-assessment";
import { checkPermission } from "@/server/permissions";

/**
 * The store's own data protection impact assessment for recordings of visits (D656; Q3, answered 18 November 2026: each store that records
 * needs its own), drawn from Kaizena Flow's template with the store's facts. The owner's alone, as recordings are: anyone else gets a 404.
 * A file to open, complete and sign; never cached.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/analytics/recordings/assessment">) {
  await connection();
  const { store: slug } = await params;
  const member = await checkPermission(slug, "owner");
  if (!member) return new NextResponse("Not found", { status: 404 });
  const { store } = member;
  const html = assessmentHtml(
    {
      storeName: store.name,
      legalName: store.details.legalName,
      organisationNumber: store.details.organisationNumber,
      postalAddress: store.details.postalAddress,
      contactEmail: store.details.contactEmail,
      share: store.recordingShare,
      mask: store.recordingMask,
      today: todayIn(new Date(), store.timeZone),
    },
    adminLangOf(member.account.adminLocale) === "nb" ? "nb" : "en",
  );
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${assessmentFileName(store.slug)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
