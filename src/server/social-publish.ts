import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret } from "@/lib/secret-box";
import { FACEBOOK_GRAPH } from "@/lib/facebook-pages";
import { LINKEDIN_API, parseImageUpload, postBody, postUrl, postUrnFrom } from "@/lib/linkedin";
import { CAROUSEL_CHANNELS, carouselSlides, mayStory } from "@/lib/social-formats";
import { pinBody, pinIdFrom, pinUrl } from "@/lib/pinterest";
import { parseInit, postState, privacyFor, TIKTOK_ONE_CHUNK_MAX, videoInitBody, videoUrl } from "@/lib/tiktok";
import { POST_CHANNELS } from "@/lib/social-posts";
import {
  CONTAINER_CHECKS,
  CONTAINER_WAIT_MS,
  containerState,
  idFrom,
  isPublishChannel,
  permalinkFrom,
  publishedText,
  publishKind,
  type PublishChannel,
} from "@/lib/social-publish";

import { audit, type Membership } from "./auth";
import { encryptionKey } from "./encryption-key";
import { FacebookError, graph } from "./facebook-pages";
import { call, GRAPH, InstagramError } from "./instagram";
import { pinterestCall, PinterestError, pinterestTarget } from "./pinterest";
import { linkedinCall, LinkedinError, linkedinTarget, restHeaders } from "./linkedin";
import { loadSharp } from "./sharp-load";
import { creatorInfo, tiktokAudited, tiktokCall, TiktokError, tiktokTarget } from "./tiktok";
import { log } from "./log";
import { storePicture } from "./media-library";
import { memberCan, NO_ACCESS } from "./permissions";
import { socialPicture } from "./social-pictures";
import { col, typedRows } from "./typed-rows";

/**
 * Publishing an approved social post (D870 S3.1, the pure parts in `src/lib/social-publish.ts`): to the store's Instagram account or Facebook
 * Page, with the token kept for it, once a person presses *Post now* or says yes to the AI manager's request. The picture goes up as a JPEG
 * kept in the store's library (Meta fetches it by its public address); the slideshow video, where the post has one, as a Reel or a Page
 * video. The post is claimed first, so it is never published twice; Meta's id and address are kept, or its refusal in its own words. The
 * only writer of `published_*`, `publish_problem` and `publish_started_at`.
 */

const POST = z.object({
  id: col.uuid,
  channel: z.enum(POST_CHANNELS),
  ref: col.text,
  title: col.text,
  caption: col.text,
  hashtags: z.array(z.string()),
  link: col.text,
  price_line: col.textOrNull,
  approved: col.bool,
  published: col.bool,
  video: col.textOrNull,
  carousel: col.bool,
  story: col.bool,
  photos: col.int,
});

type Post = z.infer<typeof POST>;
/** What goes up: one picture or video, a carousel's pictures, or a Story's frame (S2.1b). */
type Media = { kind: "picture" | "video"; url: string } | { kind: "carousel"; urls: string[] } | { kind: "story"; url: string };
type PictureOptions = { slide?: number; story?: boolean };
type Target =
  | { kind: "instagram"; userId: string; token: string }
  | { kind: "facebook"; pageId: string; token: string }
  | { kind: "pinterest"; boardId: string; token: string }
  | { kind: "tiktok"; username: string; token: string }
  | { kind: "linkedin"; author: string; token: string };

export type PublishDeps = {
  /** Meta's API, for a test: Instagram's and Facebook's callers. */
  instagram?: typeof call;
  facebook?: typeof graph;
  /** Pinterest's API, for a test. */
  pinterest?: typeof pinterestCall;
  /** TikTok's API, the video's bytes and its upload, for a test. */
  tiktok?: typeof tiktokCall;
  videoBytes?: (url: string) => Promise<Uint8Array | null>;
  upload?: (url: string, bytes: Uint8Array, headers: Record<string, string>) => Promise<boolean>;
  /** LinkedIn's API, for a test. */
  linkedin?: typeof linkedinCall;
  /** The picture's public address, for a test. */
  picture?: (member: Membership, post: Post, origin: string, options?: PictureOptions) => Promise<string | null>;
  wait?: (ms: number) => Promise<void>;
};

export type PublishResult = { ok: true; url: string | null } | { ok: false; problem: string };

/** The account a store publishes to on a channel, with its token; Kaizena Flow's own store uses the platform's Instagram while it has none. */
async function targetOf(store: Membership["store"], channel: PublishChannel, deps: PublishDeps): Promise<Target | { problem: string }> {
  const key = encryptionKey();
  if (!key) return { problem: "Publishing is not set up here." };
  if (channel === "linkedin") {
    const place = await linkedinTarget(store.id, new Date(), deps.linkedin);
    return "problem" in place ? place : { kind: "linkedin", ...place };
  }
  if (channel === "tiktok") {
    const account = await tiktokTarget(store.id, new Date(), deps.tiktok);
    return "problem" in account ? account : { kind: "tiktok", ...account };
  }
  if (channel === "pinterest") {
    const board = await pinterestTarget(store.id, new Date(), deps.pinterest);
    return "problem" in board ? board : { kind: "pinterest", ...board };
  }
  if (channel === "instagram") {
    const rows = await typedRows(
      z.object({ store_id: col.uuid.nullable(), user: col.text, token: col.text, publish: col.bool, live: col.bool }),
      sql`select store_id, ig_user_id as user, token_encrypted as token, publish, token_expires_at > now() as live from commerce.instagram_accounts
        where store_id = ${store.id}::uuid ${store.house ? sql`or store_id is null` : sql``} order by store_id nulls last limit 1`,
    );
    const account = rows[0];
    if (!account) return { problem: "Connect the store's Instagram account first." };
    if (!account.live) return { problem: "The Instagram connection has run out. Connect it again." };
    if (!account.publish) return { problem: "Connect Instagram again and allow publishing, so Kaizena Flow may post for you." };
    return { kind: "instagram", userId: account.user, token: decryptSecret(account.token, key) };
  }
  const [page] = await typedRows(
    z.object({ page_id: col.textOrNull, token: col.textOrNull, publish: col.bool }),
    sql`select page_id, page_token_encrypted as token, publish from commerce.facebook_pages where store_id = ${store.id}::uuid`,
  );
  if (!page?.page_id || !page.token) return { problem: "Connect the store's Facebook Page first." };
  if (!page.publish) return { problem: "Connect Facebook again and allow posting to the Page, so Kaizena Flow may post for you." };
  return { kind: "facebook", pageId: page.page_id, token: decryptSecret(page.token, key) };
}

/**
 * The post's picture as the platform will fetch it: drawn (or its Canva copy), a carousel's later slide or its Story frame (S2.1b), as a JPEG
 * kept in the store's library; its public address.
 */
async function publicPicture(member: Membership, post: Post, origin: string, options: PictureOptions = {}): Promise<string | null> {
  const drawn = await socialPicture(member, post.id, origin, {}, options);
  if (!drawn.ok) return null;
  const sharp = await loadSharp();
  const bytes = Buffer.from(await drawn.response.arrayBuffer());
  // Instagram takes JPEG only; a quality that keeps words crisp.
  const jpeg = await sharp(bytes).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
  const thumb = await sharp(jpeg).resize({ width: 480 }).jpeg({ quality: 80 }).toBuffer();
  const name = `post-${post.ref}-${post.channel}${options.story ? "-story" : options.slide ? `-${options.slide + 1}` : ""}.jpg`;
  const stored = await storePicture(
    { storeId: member.store.id, accountId: member.account.id },
    new File([new Uint8Array(jpeg)], name, { type: "image/jpeg" }),
    new File([new Uint8Array(thumb)], name.replace(/\.jpg$/, "-480.jpg"), { type: "image/jpeg" }),
    { fileName: name },
  );
  return stored.ok ? stored.url : null;
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
const form = (params: Record<string, string>): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });

/**
 * Publishes to Instagram: a container for the picture (or the video as a Reel, or the frame as a Story), or one for each of a carousel's
 * pictures and then the carousel's own; each waited on while it is processed, then published.
 */
async function toInstagram(target: Extract<Target, { kind: "instagram" }>, media: Media, text: string, deps: PublishDeps) {
  const ig = deps.instagram ?? call;
  const make = async (params: Record<string, string>) => {
    const id = idFrom(await ig(`${GRAPH}/v24.0/${target.userId}/media`, form({ ...params, access_token: target.token })));
    if (!id) throw new InstagramError("Instagram did not take the post.");
    for (let i = 0; ; i++) {
      const state = containerState(await ig(`${GRAPH}/v24.0/${id}?${q({ fields: "status_code", access_token: target.token })}`));
      if (state === "ready") return id;
      if (state === "failed") throw new InstagramError("Instagram could not process the post's picture or video.");
      if (i >= CONTAINER_CHECKS) throw new InstagramError("Instagram took too long to process the video. Try again in a moment.");
      await (deps.wait ?? pause)(CONTAINER_WAIT_MS);
    }
  };
  let container: string;
  if (media.kind === "carousel") {
    const children: string[] = [];
    for (const url of media.urls) children.push(await make({ image_url: url, is_carousel_item: "true" }));
    container = await make({ media_type: "CAROUSEL", children: children.join(","), caption: text });
  } else if (media.kind === "story") container = await make({ media_type: "STORIES", image_url: media.url });
  else container = await make(media.kind === "video" ? { media_type: "REELS", video_url: media.url, caption: text } : { image_url: media.url, caption: text });
  const mediaId = idFrom(await ig(`${GRAPH}/v24.0/${target.userId}/media_publish`, form({ creation_id: container, access_token: target.token })));
  if (!mediaId) throw new InstagramError("Instagram did not publish the post.");
  const url = permalinkFrom(await ig(`${GRAPH}/v24.0/${mediaId}?${q({ fields: "permalink", access_token: target.token })}`).catch(() => null));
  return { id: mediaId, url };
}

/**
 * Publishes to the Page: a photo with the words as its message, or the video with them as its description; a carousel as its photos sent
 * unpublished, then one post holding them all; a Story as a photo sent unpublished, then made the Page's Story.
 */
async function toFacebook(target: Extract<Target, { kind: "facebook" }>, media: Media, text: string, deps: PublishDeps) {
  const fb = deps.facebook ?? graph;
  const page = `${FACEBOOK_GRAPH}/${target.pageId}`;
  const unpublished = async (url: string) => {
    const id = idFrom(await fb(`${page}/photos`, form({ url, published: "false", access_token: target.token }), 60_000));
    if (!id) throw new FacebookError("Facebook did not take the picture.");
    return id;
  };
  if (media.kind === "story") {
    const photo = await unpublished(media.url);
    const made = await fb(`${page}/photo_stories`, form({ photo_id: photo, access_token: target.token }), 60_000);
    return { id: idFrom(made, "post_id") ?? photo, url: null };
  }
  let made: Record<string, unknown>;
  if (media.kind === "carousel") {
    const photos: string[] = [];
    for (const url of media.urls) photos.push(await unpublished(url));
    made = await fb(`${page}/feed`, form({ message: text, attached_media: JSON.stringify(photos.map((id) => ({ media_fbid: id }))), access_token: target.token }), 60_000);
  } else {
    made =
      media.kind === "video"
        ? await fb(`${page}/videos`, form({ file_url: media.url, description: text, access_token: target.token }), 60_000)
        : await fb(`${page}/photos`, form({ url: media.url, message: text, published: "true", access_token: target.token }), 60_000);
  }
  const id = idFrom(made, "post_id") ?? idFrom(made);
  if (!id) throw new FacebookError("Facebook did not publish the post.");
  const url = permalinkFrom(await fb(`${FACEBOOK_GRAPH}/${id}?${q({ fields: "permalink_url", access_token: target.token })}`).catch(() => null));
  return { id, url };
}

/** Pins the post to the board: its picture, title, words and tagged link. A Pin is a picture: a slideshow is not pinned. */
async function toPinterest(target: Extract<Target, { kind: "pinterest" }>, post: Post, imageUrl: string | string[], deps: PublishDeps) {
  const call = deps.pinterest ?? pinterestCall;
  const made = await call("/pins", {
    method: "POST",
    headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(pinBody(target.boardId, { channel: post.channel, title: post.title, caption: post.caption, hashtags: post.hashtags, link: post.link, priceLine: post.price_line }, imageUrl)),
  });
  const id = pinIdFrom(made);
  if (!id) throw new PinterestError("Pinterest did not make the Pin.");
  return { id, url: pinUrl(id) };
}

/** A file's bytes (the video, or the picture for LinkedIn), read from the library's public address; null when it cannot be read. */
async function readBytes(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) }).catch(() => null);
  return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

/** Puts a file to the address the platform gave, in one piece, with the headers it asks for (its type first). */
async function putBytes(url: string, bytes: Uint8Array, headers: Record<string, string>): Promise<boolean> {
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: new Blob([new Uint8Array(bytes)], { type: headers["Content-Type"] }),
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  return Boolean(response?.ok);
}

/**
 * Posts the slideshow video to TikTok, uploaded as a file: TikTok's creator info asked first (who may see the post: private until the app is
 * audited), the post started, the video put, and the post waited on while TikTok processes it. One TikTok accepted but still processing is
 * kept as posted, without an address.
 */
async function toTiktok(target: Extract<Target, { kind: "tiktok" }>, videoAt: string, text: string, deps: PublishDeps) {
  const call = deps.tiktok ?? tiktokCall;
  const bytes = await (deps.videoBytes ?? readBytes)(videoAt);
  if (!bytes || bytes.length === 0) throw new TiktokError("The post's video could not be read.");
  if (bytes.length > TIKTOK_ONE_CHUNK_MAX) throw new TiktokError("The post's video is larger than TikTok takes in one piece.");
  const creator = await creatorInfo(target.token, call);
  const started = parseInit(
    await call("/post/publish/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(videoInitBody(text, privacyFor(creator.privacy, tiktokAudited()), bytes.length)),
    }),
  );
  if (!started) throw new TiktokError("TikTok did not start the post.");
  if (!(await (deps.upload ?? putBytes)(started.uploadUrl, bytes, { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` }))) throw new TiktokError("The video could not be sent to TikTok. Try again.");
  for (let i = 0; i < CONTAINER_CHECKS; i++) {
    const state = postState(
      await call("/post/publish/status/fetch/", {
        method: "POST",
        headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: started.publishId }),
      }),
    );
    if (state.state === "done") return { id: state.postId ?? started.publishId, url: videoUrl(creator.username || target.username, state.postId) };
    if (state.state === "failed") throw new TiktokError(`TikTok could not post the video: ${state.reason}`);
    await (deps.wait ?? pause)(CONTAINER_WAIT_MS);
  }
  return { id: started.publishId, url: null };
}

/**
 * Posts to LinkedIn as the chosen profile or Page: each picture uploaded through the Images API, then the post with its words, public, as a
 * multi-image post where there are several (a carousel, S2.1b).
 */
async function toLinkedin(target: Extract<Target, { kind: "linkedin" }>, pictures: string[], text: string, alt: string, deps: PublishDeps) {
  const call = deps.linkedin ?? linkedinCall;
  const images: string[] = [];
  for (const pictureAt of pictures) {
    const bytes = await (deps.videoBytes ?? readBytes)(pictureAt);
    if (!bytes || bytes.length === 0) throw new LinkedinError("The post's picture could not be read.");
    const upload = parseImageUpload(
      (
        await call(`${LINKEDIN_API}/rest/images?action=initializeUpload`, {
          method: "POST",
          headers: restHeaders(target.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ initializeUploadRequest: { owner: target.author } }),
        })
      ).json,
    );
    if (!upload) throw new LinkedinError("LinkedIn did not take the picture.");
    if (!(await (deps.upload ?? putBytes)(upload.uploadUrl, bytes, { "Content-Type": "image/jpeg", Authorization: `Bearer ${target.token}` }))) {
      throw new LinkedinError("The picture could not be sent to LinkedIn. Try again.");
    }
    images.push(upload.image);
  }
  const made = await call(`${LINKEDIN_API}/rest/posts`, {
    method: "POST",
    headers: restHeaders(target.token, { "Content-Type": "application/json" }),
    body: JSON.stringify(postBody(target.author, text, images.length === 1 ? images[0] : images, alt)),
  });
  const urn = postUrnFrom(made.restliId);
  if (!urn) throw new LinkedinError("LinkedIn did not publish the post.");
  return { id: urn, url: postUrl(urn) };
}

/**
 * Publishes one of the store's approved posts now, to its channel (Instagram, Facebook, Pinterest, TikTok or LinkedIn). Refused without the marketing permission, for a
 * post not approved, already published or being published, for a channel Kaizena Flow does not post to, and without a connection that
 * allows publishing. Audited with who published it.
 */
export async function publishSocialPost(member: Membership, postId: unknown, origin: string, deps: PublishDeps = {}): Promise<PublishResult> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const id = z.uuid().safeParse(postId);
  if (!id.success) return { ok: false, problem: "Choose a post." };
  const { store } = member;
  const [post] = await typedRows(
    POST,
    sql`select p.id, p.channel, p.ref, p.title, p.caption, p.hashtags, p.link, p.price_line, p.approved_at is not null as approved,
        p.published_at is not null as published, v.url as video, p.carousel, p.story,
        (select count(*)::int from commerce.product_media pm where pm.store_id = p.store_id and pm.product_id = p.product_id) as photos
      from commerce.social_posts p left join commerce.media v on v.id = p.video_media_id and v.store_id = p.store_id and v.kind = 'video'
      where p.store_id = ${store.id}::uuid and p.id = ${id.data}::uuid`,
  );
  if (!post) return { ok: false, problem: "That post is not this store's." };
  if (!isPublishChannel(post.channel)) return { ok: false, problem: "Kaizena Flow does not post to this channel yet: copy the post into it." };
  if (post.published) return { ok: false, problem: "This post is published already." };
  if (!post.approved) return { ok: false, problem: "Approve the post before it is published." };
  // A TikTok post is its slideshow video (S3.5).
  if (post.channel === "tiktok" && !post.video) return { ok: false, problem: "A TikTok post goes out as its video: make the video first." };
  const target = await targetOf(store, post.channel, deps);
  if ("problem" in target) return { ok: false, problem: target.problem };

  // The claim: one publish at a time, and never one for a post that is out already.
  const claimed = await db().execute(sql`
    update commerce.social_posts set publish_started_at = now(), publish_problem = null
    where store_id = ${store.id}::uuid and id = ${post.id}::uuid and published_at is null and approved_at is not null
      and (publish_started_at is null or publish_started_at < now() - interval '5 minutes')
    returning id`);
  if (claimed.length === 0) return { ok: false, problem: "This post is being published already." };

  try {
    const kind = target.kind === "pinterest" || target.kind === "linkedin" ? "picture" : target.kind === "tiktok" ? "video" : publishKind(Boolean(post.video));
    const picture = (options?: PictureOptions) => (deps.picture ?? publicPicture)(member, post, origin, options);
    const url = kind === "video" ? post.video : await picture();
    if (!url) throw new InstagramError("The post's picture could not be made ready to publish.");
    // A carousel (S2.1b): the drawn picture, the product's other photos and its closing slide; a video goes out as itself instead.
    const slides = post.carousel && kind === "picture" && post.photos > 0 && CAROUSEL_CHANNELS.includes(post.channel) ? carouselSlides(post.photos) : [];
    const urls = [url];
    for (let n = 1; n < slides.length; n++) {
      const slide = await picture({ slide: n });
      if (!slide) throw new InstagramError("A picture of the carousel could not be made ready to publish.");
      urls.push(slide);
    }
    const media: Media = urls.length > 1 ? { kind: "carousel", urls } : { kind, url };
    const text = publishedText({ channel: post.channel, title: post.title, caption: post.caption, hashtags: post.hashtags, link: post.link, priceLine: post.price_line });
    const done =
      target.kind === "instagram"
        ? await toInstagram(target, media, text, deps)
        : target.kind === "facebook"
          ? await toFacebook(target, media, text, deps)
          : target.kind === "pinterest"
            ? await toPinterest(target, post, urls.length > 1 ? urls : url, deps)
            : target.kind === "tiktok"
              ? await toTiktok(target, url, text, deps)
              : await toLinkedin(target, urls, text, post.title || post.caption, deps);
    // The Story (S2.1b), after the post: one that fails leaves the post out, with why on it.
    let storyProblem: string | null = null;
    if (post.story && mayStory(post.channel) && (target.kind === "instagram" || target.kind === "facebook")) {
      try {
        const frame = await picture({ story: true });
        if (!frame) throw new InstagramError("The Story's picture could not be made ready.");
        if (target.kind === "instagram") await toInstagram(target, { kind: "story", url: frame }, text, deps);
        else await toFacebook(target, { kind: "story", url: frame }, text, deps);
      } catch (error) {
        if (!(error instanceof InstagramError || error instanceof FacebookError)) log("error", "social.story_failed", { post: post.id }, error);
        storyProblem = `Posted, but the Story was not: ${error instanceof InstagramError || error instanceof FacebookError ? error.message : "it could not be published."}`.slice(0, 300);
      }
    }
    await db().execute(sql`
      update commerce.social_posts set published_at = now(), published_by = ${member.account.id}::uuid, published_id = ${done.id},
        published_url = ${done.url}, publish_problem = ${storyProblem}, publish_started_at = null
      where store_id = ${store.id}::uuid and id = ${post.id}::uuid`);
    await audit(member.account.id, store.id, "store.social_post_published", { channel: post.channel, kind: media.kind, story: post.story && !storyProblem });
    return { ok: true, url: done.url };
  } catch (error) {
    const said = error instanceof InstagramError || error instanceof FacebookError || error instanceof PinterestError || error instanceof TiktokError || error instanceof LinkedinError;
    if (!said) log("error", "social.publish_failed", { post: post.id, channel: post.channel }, error);
    const problem = said ? error.message.slice(0, 300) : "The post could not be published. Try again.";
    await db().execute(sql`update commerce.social_posts set publish_problem = ${problem}, publish_started_at = null where store_id = ${store.id}::uuid and id = ${post.id}::uuid`);
    return { ok: false, problem };
  }
}

/** Where the store may publish from the calendar now: each channel whose connection allows it (Kaizena Flow's store: the platform's Instagram too). */
export async function publishTargets(store: Membership["store"]): Promise<Record<PublishChannel, boolean>> {
  const [row] = await typedRows(
    z.object({ instagram: col.bool, facebook: col.bool, pinterest: col.bool, tiktok: col.bool, linkedin: col.bool }),
    sql`select
      exists (select 1 from commerce.instagram_accounts where (store_id = ${store.id}::uuid ${store.house ? sql`or store_id is null` : sql``}) and publish and token_expires_at > now()) as instagram,
      exists (select 1 from commerce.facebook_pages where store_id = ${store.id}::uuid and publish and page_id is not null) as facebook,
      exists (select 1 from commerce.pinterest_accounts where store_id = ${store.id}::uuid and publish and board_id is not null and refresh_expires_at > now()) as pinterest,
      exists (select 1 from commerce.tiktok_accounts where store_id = ${store.id}::uuid and publish and refresh_expires_at > now()) as tiktok,
      exists (select 1 from commerce.linkedin_accounts where store_id = ${store.id}::uuid and publish and author_urn is not null and token_expires_at > now()) as linkedin`,
  );
  return { instagram: row?.instagram ?? false, facebook: row?.facebook ?? false, pinterest: row?.pinterest ?? false, tiktok: row?.tiktok ?? false, linkedin: row?.linkedin ?? false };
}
