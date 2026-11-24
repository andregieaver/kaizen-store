import { NextResponse, type NextRequest } from "next/server";

import { mayReadLegalReviews } from "@/lib/platform-access";
import { sameSite } from "@/lib/same-site";
import { requireAccount } from "@/server/auth";
import { saveView } from "@/server/legal-reviews";

/**
 * Keeps a lawyer's view on one point of a legal review (D892): a POST from the review's own form, by the platform's owners and lawyers
 * only, then back to the review at that point. A route rather than a server action, so Legal reviews adds nothing to the actions every
 * admin page loads.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/legal/[review]/view">) {
  const { review } = await params;
  const account = await requireAccount();
  if (!mayReadLegalReviews(account)) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const item = String(form?.get("item") ?? "");
  const result = await saveView(account, review, item, String(form?.get("view") ?? ""));
  const back = new URL(`/admin/legal/${encodeURIComponent(review)}`, request.url);
  if (result.ok) back.searchParams.set("saved", item);
  else {
    back.searchParams.set("problem", result.problem);
    back.searchParams.set("item", item);
  }
  back.hash = `item-${item}`;
  return NextResponse.redirect(back, 303);
}
