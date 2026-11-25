import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { checkPermission } from "@/server/permissions";
import { markSocialPostCopied } from "@/server/social-posts";

/** Notes the first time a member copied a post (D870 C1): a route, so the screen adds no server action. */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/copied/[postId]">) {
  const { store, postId } = await params;
  const member = await checkPermission(store, "marketing:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return NextResponse.json({ ok: await markSocialPostCopied(member, postId) });
}
