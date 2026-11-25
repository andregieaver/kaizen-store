import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { checkPermission } from "@/server/permissions";
import { approveSocialPosts, editSocialPost } from "@/server/social-calendar";

/**
 * The social calendar's buttons (D870 S2.4), for a member who may change marketing: `approve` and `unapprove` a list of posts (one, or a
 * week's), `edit` one post's words. A route, so the screen adds no server action; answers the server function's result as JSON.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/calendar">) {
  const member = await checkPermission((await params).store, "marketing:write", "social");
  if (!member) return NextResponse.json({ ok: false, problem: "Not found." }, { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { do?: unknown; ids?: unknown } | null;
  if (body?.do === "approve" || body?.do === "unapprove") return NextResponse.json(await approveSocialPosts(member, body.ids, body.do === "approve"));
  if (body?.do === "edit") return NextResponse.json(await editSocialPost(member, body));
  return NextResponse.json({ ok: false, problem: "Unknown request." }, { status: 400 });
}
