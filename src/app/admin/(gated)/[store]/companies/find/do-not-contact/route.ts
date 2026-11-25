import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { addDoNotContactByHand } from "@/server/do-not-contact";
import { checkPermission } from "@/server/permissions";

/**
 * Adds an address or a domain to the do-not-contact list every store and the platform share (email plan P5.6, D893), from Find companies'
 * form: a member who may change customers, of Kaizena Flow's own store while the tool is the platform's. A route, so the page adds no server
 * action; back to the page with what happened.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/companies/find/do-not-contact">) {
  const { store: slug } = await params;
  const member = await checkPermission(slug, "customers:write");
  if (!member || !member.store.house) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const result = await addDoNotContactByHand(member.account, member.store.id, String(form?.get("entry") ?? ""));
  const back = new URL(`/admin/${slug}/companies/find`, request.url);
  back.searchParams.set("dnc", result.ok ? "added" : "invalid");
  return NextResponse.redirect(back, 303);
}
