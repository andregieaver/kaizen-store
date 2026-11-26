import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { checkPermission } from "@/server/permissions";
import { approveSocialPosts, editSocialPost } from "@/server/social-calendar";
import { dropSocialScene, makeSocialScene } from "@/server/social-scenes";
import { keepSlideshow, startSlideshowUpload } from "@/server/social-slideshow";
import { checkSocialPosts } from "@/server/social-vision";

/**
 * The social calendar's buttons (D870 S2.4), for a member who may change marketing: `approve` and `unapprove` a list of posts (one, or a
 * week's), `edit` one post's words, `check` posts' pictures (S2.3), `scene` and `no_scene` for one post's made scene (S2.1). A route, so the screen adds no server action; answers the server function's result as JSON.
 */
/** Making a scene asks the picture model, perhaps more than once. */
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/calendar">) {
  const member = await checkPermission((await params).store, "marketing:write", "social");
  if (!member) return NextResponse.json({ ok: false, problem: "Not found." }, { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { do?: unknown; ids?: unknown } | null;
  if (body?.do === "approve" || body?.do === "unapprove") return NextResponse.json(await approveSocialPosts(member, body.ids, body.do === "approve"));
  if (body?.do === "edit") return NextResponse.json(await editSocialPost(member, body));
  // The vision check (S2.3): each picture looked at by the store's model that sees pictures.
  if (body?.do === "check") return NextResponse.json(await checkSocialPosts(member, body.ids, request.nextUrl.origin));
  // A made scene for one post (S2.1), checked and made again while the check fails it; or back to the drawn picture.
  const post = (body as { id?: unknown } | null)?.id;
  if (body?.do === "scene") return NextResponse.json(await makeSocialScene(member, post, request.nextUrl.origin));
  if (body?.do === "no_scene") return NextResponse.json(await dropSocialScene(member, post));
  // The slideshow made in the browser (S2.5): its upload started, then kept on the post once it is there.
  const extra = body as { size?: unknown; path?: unknown } | null;
  if (body?.do === "video_start") return NextResponse.json(await startSlideshowUpload(member, post, extra?.size));
  if (body?.do === "video_keep") return NextResponse.json(await keepSlideshow(member, post, extra?.path));
  return NextResponse.json({ ok: false, problem: "Unknown request." }, { status: 400 });
}
