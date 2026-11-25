import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { checkPermission } from "@/server/permissions";
import { writeSocialPosts } from "@/server/social-posts";

/**
 * Writes the posts the creator asked for (D870 C1), for a member who may change marketing: a route, not a server action, so it adds no entry
 * to the server-reference manifest of every route (scripts/route-budget.mjs). Answers `writeSocialPosts()`'s result as JSON.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/write">) {
  const member = await checkPermission((await params).store, "marketing:write", "social");
  if (!member) return NextResponse.json({ ok: false, problem: "Not found." }, { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const input = await request.json().catch(() => null);
  return NextResponse.json(await writeSocialPosts(member, input));
}
