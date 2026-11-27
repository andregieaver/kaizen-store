import { NextResponse, type NextRequest } from "next/server";

import { checkPermission } from "@/server/permissions";
import { socialPicture } from "@/server/social-pictures";

/**
 * A social post's picture (D870 C2), for a member who may see the marketing area: shown on the post's card, and with `?download=1` saved
 * under the channel's name and shape; `?slide=n` a carousel's later slide and `?story=1` its Story frame (S2.1b).
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/picture/[postId]">) {
  const { store: slug, postId } = await params;
  const member = await checkPermission(slug, "marketing:read", "social");
  if (!member) return new NextResponse("Not found", { status: 404 });
  const query = request.nextUrl.searchParams;
  // A carousel's later slide (`?slide=1` on) or the Story frame (`?story=1`, S2.1b).
  const result = await socialPicture(member, postId, request.nextUrl.origin, {}, { slide: Number(query.get("slide") ?? 0) || 0, story: query.get("story") === "1" });
  if (!result.ok) return new NextResponse("Not found", { status: 404 });
  if (query.get("download") === "1") result.response.headers.set("Content-Disposition", `attachment; filename="${result.fileName}"`);
  return result.response;
}
