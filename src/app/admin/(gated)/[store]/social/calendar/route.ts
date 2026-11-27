import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { checkPermission } from "@/server/permissions";
import { approveSocialPosts, editSocialPost, setPostFormat } from "@/server/social-calendar";
import { saveSocialRules } from "@/server/social-rules";
import { dropSocialScene, makeSocialScene } from "@/server/social-scenes";
import { keepSlideshow, startSlideshowUpload } from "@/server/social-slideshow";
import { publishSocialPost } from "@/server/social-publish";
import { scheduleSocialPosts } from "@/server/social-queue";
import { checkSocialPosts } from "@/server/social-vision";

/**
 * The social calendar's buttons (D870 S2.4), for a member who may change marketing: `approve` and `unapprove` a list of posts (one, or a
 * week's), `edit` one post's words, `check` posts' pictures (S2.3), `scene` and `no_scene` for one post's made scene (S2.1), and `rules`, the owner's *Post on its own within my rules* (S3.3). A route, so the screen adds no server action; answers the server function's result as JSON.
 */
/** Making a scene asks the picture model, perhaps more than once. */
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/calendar">) {
  const member = await checkPermission((await params).store, "marketing:write", "social");
  if (!member) return NextResponse.json({ ok: false, problem: "Not found." }, { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { do?: unknown; ids?: unknown } | null;
  if (body?.do === "approve") {
    const approved = await approveSocialPosts(member, body.ids, true);
    // An approved Instagram or Facebook post is queued for its planned day (S3.2); the calendar shows when, and it can be taken off.
    if (approved.ok) await scheduleSocialPosts(member, body.ids, true);
    return NextResponse.json(approved);
  }
  // *Post on its own within my rules* (S3.3): the owner's switch and limits; switched off, the posts the rules queued wait for a yes again.
  if (body?.do === "rules") return NextResponse.json(await saveSocialRules(member, body));
  // A carousel or one picture, a Story too or not (S2.1b).
  if (body?.do === "format") return NextResponse.json(await setPostFormat(member, body));
  if (body?.do === "unapprove") return NextResponse.json(await approveSocialPosts(member, body.ids, false));
  if (body?.do === "schedule" || body?.do === "unschedule") return NextResponse.json(await scheduleSocialPosts(member, body.ids, body.do === "schedule"));
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
  // Publishing an approved post now (S3.1): a person's press is the yes.
  if (body?.do === "publish") return NextResponse.json(await publishSocialPost(member, post, request.nextUrl.origin));
  return NextResponse.json({ ok: false, problem: "Unknown request." }, { status: 400 });
}
