import { NextResponse, type NextRequest } from "next/server";

import { checkPermission } from "@/server/permissions";
import { slidePhoto, slideshowPlan } from "@/server/social-slideshow";

/**
 * A post's slideshow (D870 S2.5), for a member who may see the marketing area: without `n`, the photos the browser draws and the colour
 * behind them (JSON); with `n`, the product's photo of that number from the store's own files, so the browser may draw it.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/slides/[postId]">) {
  const { store: slug, postId } = await params;
  const member = await checkPermission(slug, "marketing:read", "social");
  if (!member) return new NextResponse("Not found", { status: 404 });
  const n = request.nextUrl.searchParams.get("n");
  if (n === null) {
    const plan = await slideshowPlan(member, postId, `/admin/${member.store.slug}/social`);
    return plan.ok ? NextResponse.json(plan) : new NextResponse("Not found", { status: 404 });
  }
  const photo = await slidePhoto(member, postId, Number(n), request.nextUrl.origin);
  if (!photo) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(photo), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
