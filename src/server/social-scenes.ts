import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { mayRemakeScene, sceneBrief, sceneShape } from "@/lib/social-scenes";
import { POST_CHANNELS } from "@/lib/social-posts";
import { checkFailed, type CheckVerdict } from "@/lib/social-vision";

import { audit, type Membership } from "./auth";
import { listGridProducts } from "./catalog";
import { memberCan, NO_ACCESS } from "./permissions";
import { editLibraryPicture } from "./picture-editor";
import { makeSitePicture } from "./picture-maker";
import { checkSocialPosts, type CheckDeps } from "./social-vision";
import type { Store } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * A social post's made scene (D870 S2.1, the brief in `src/lib/social-scenes.ts`): a product's own photo with a new background, by the
 * library's AI edit (`editLibraryPicture()`, `new_background`: the product kept as it is, the result kept in the library as AI-edited), or
 * for a page or topic a background made in the site's look (`makeSitePicture()`). The post then draws it in the photo's place
 * (`socialPicture()`). Made on a person's request, checked by the vision check, and made again at most twice while the check fails it.
 * The only writer of `scene_media_id` and `scene_tries`.
 */

const POST = z.object({
  id: col.uuid,
  channel: z.enum(POST_CHANNELS),
  product_id: z.string().nullable(),
  page_id: z.string().nullable(),
  topic: col.text,
  planned_for: col.textOrNull,
  tries: col.int,
});

export type SceneDeps = {
  edit?: typeof editLibraryPicture;
  make?: typeof makeSitePicture;
  check?: CheckDeps;
  /** How long to keep making scenes again after a failed check (default two minutes). */
  budgetMs?: number;
  /** The calendar's idea for the post's day, read from the newest advice by default. */
  idea?: (storeId: string, day: string | null, channel: string) => Promise<string>;
};

/** The newest advice's plan for a day and channel, where it has one. */
async function plannedIdea(storeId: string, day: string | null, channel: string): Promise<string> {
  if (!day) return "";
  const [row] = await typedRows(
    z.object({ idea: col.textOrNull }),
    sql`select s ->> 'idea' as idea from (select advice from commerce.social_advice where store_id = ${storeId}::uuid order by created_at desc limit 1) a,
      jsonb_array_elements(a.advice -> 'calendar') s where s ->> 'day' = ${day} and s ->> 'channel' = ${channel} limit 1`,
  );
  return row?.idea ?? "";
}

/** Makes one scene for a post and keeps it on the post; the library picture's id, or why not. */
async function makeScene(member: Membership, store: Store, post: z.infer<typeof POST>, deps: SceneDeps): Promise<{ ok: true; mediaId: string } | { ok: false; problem: string }> {
  const owner = { store, accountId: member.account.id };
  const idea = (await (deps.idea ?? plannedIdea)(store.id, post.planned_for, post.channel)) || post.topic;
  const market = store.markets[0];
  const product =
    post.product_id && market ? ((await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "given", limit: 1, ids: [post.product_id] }))[0] ?? null) : null;
  let url: string;
  let mediaId: string | null = null;
  if (product?.image?.url) {
    const edited = await (deps.edit ?? editLibraryPicture)(owner, { url: product.image.url, action: "new_background", brief: sceneBrief({ kind: "product", title: product.title, idea }) });
    if (!edited.ok) return edited;
    url = edited.picture.url;
    mediaId = edited.picture.id;
  } else {
    const made = await (deps.make ?? makeSitePicture)(owner, {
      brief: sceneBrief({ kind: post.page_id ? "page" : "topic", title: product?.title ?? "", idea }),
      shape: sceneShape(post.channel),
      follow: true,
      place: "library",
    });
    if (!made.ok) return made;
    url = made.picture.url;
  }
  if (!mediaId) {
    const [row] = await typedRows(z.object({ id: col.uuid }), sql`select id from commerce.media where store_id = ${store.id}::uuid and url = ${url} limit 1`);
    mediaId = row?.id ?? null;
  }
  if (!mediaId) return { ok: false, problem: "The scene was made but could not be found in the library." };
  // The picture changed: its old verdict and yes no longer hold.
  await db().execute(sql`
    update commerce.social_posts set scene_media_id = ${mediaId}::uuid, scene_tries = scene_tries + 1,
      checked_at = null, check_problems = '{}', check_note = '', approved_at = null, approved_by = null, scheduled_for = null, scheduled_by = null
    where store_id = ${store.id}::uuid and id = ${post.id}::uuid`);
  return { ok: true, mediaId };
}

/**
 * Makes a scene for one of the store's posts and checks it; while the check fails it and the post has tries left (`SCENE_TRIES_MAX`), makes
 * it again. The last verdict, or why no scene was made. Audited.
 */
export async function makeSocialScene(
  member: Membership,
  postId: unknown,
  origin: string,
  deps: SceneDeps = {},
): Promise<{ ok: true; tries: number; verdict: CheckVerdict | null } | { ok: false; problem: string }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const id = z.uuid().safeParse(postId);
  if (!id.success) return { ok: false, problem: "Choose a post." };
  const { store } = member;
  const read = async () =>
    (
      await typedRows(
        POST,
        sql`select id, channel, product_id, page_id, topic, planned_for::text as planned_for, scene_tries as tries
          from commerce.social_posts where store_id = ${store.id}::uuid and id = ${id.data}::uuid and published_at is null and publish_started_at is null`,
      )
    )[0];
  let post = await read();
  if (!post) return { ok: false, problem: "That post is not this store's, or it is published." };
  if (!mayRemakeScene(post.tries)) return { ok: false, problem: "This post's scene has been made as often as it may be. Use the drawn picture, or change it in Canva." };
  let verdict: CheckVerdict | null = null;
  // A scene takes up to a couple of minutes to make: no new one is started past this, so the request ends within its time.
  const until = Date.now() + (deps.budgetMs ?? 120_000);
  do {
    const made = await makeScene(member, store, post, deps);
    if (!made.ok) return made;
    const checked = await checkSocialPosts(member, [post.id], origin, deps.check);
    verdict = checked.ok ? (checked.checked[post.id] ?? null) : null;
    post = (await read())!;
  } while (verdict && checkFailed(verdict.problems) && mayRemakeScene(post.tries) && Date.now() < until);
  await audit(member.account.id, store.id, "store.social_scene_made", { tries: post.tries, passed: verdict ? !checkFailed(verdict.problems) : null });
  return { ok: true, tries: post.tries, verdict };
}

/** Goes back to the drawn picture: the scene stays in the library, the post no longer uses it; its verdict is cleared. */
export async function dropSocialScene(member: Membership, postId: unknown): Promise<{ ok: boolean }> {
  if (!memberCan(member, "marketing:write")) return { ok: false };
  const id = z.uuid().safeParse(postId);
  if (!id.success) return { ok: false };
  const rows = await db().execute(sql`
    update commerce.social_posts set scene_media_id = null, checked_at = null, check_problems = '{}', check_note = ''
    where store_id = ${member.store.id}::uuid and id = ${id.data}::uuid and scene_media_id is not null and published_at is null returning id`);
  return { ok: rows.length > 0 };
}
