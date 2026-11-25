import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { PICTURE_SIZES, pictureFileName, POST_CHANNELS } from "@/lib/social-posts";

import { audit, type Membership } from "./auth";
import { reopenCanvaDesign, sendToCanva, startCanvaEdit, type CanvaDeps, type CanvaOutcome, type CanvaOwner, type EditTarget } from "./canva";
import { socialPicture } from "./social-pictures";
import { col, typedRow } from "./typed-rows";

/**
 * A social post's picture in Canva (D898 C3, `docs/design-tools.md`): the owner said yes to keeping an edited post picture in the library.
 * The post's card opens Canva in a tab of its own as a picture field does (C2); brought back, the copy is a library item (`made_by =
 * 'canva'`) and the post's picture (`social_posts.picture_media_id`), shown and downloaded in place of the one drawn by code.
 */

/** Draws a post's picture by code (`socialPicture()`), as PNG bytes; injected by the tests. */
type Draw = (member: Membership, postId: string, origin: string) => Promise<Uint8Array | null>;

const drawPicture: Draw = async (member, postId, origin) => {
  const drawn = await socialPicture(member, postId, origin, {}, { drawn: true });
  return drawn.ok ? new Uint8Array(await drawn.response.arrayBuffer()) : null;
};

/**
 * *Edit in Canva* on a post: the person's own earlier design of this post goes on where they left it; else its picture from Canva, else the
 * picture drawn by code, goes to Canva in the channel's shape. The answer is the link that opens it, for the tab the card opened.
 */
export async function startPostEdit(
  member: Membership,
  postId: string,
  origin: string,
  deps: CanvaDeps & { draw?: Draw } = {},
): Promise<CanvaOutcome<{ url: string; editId: string }>> {
  if (!z.uuid().safeParse(postId).success) return { ok: false, problem: "gone" };
  const owner: CanvaOwner = { storeId: member.store.id, storeSlug: member.store.slug, accountId: member.account.id };
  const post = await typedRow(
    z.object({ id: col.uuid, channel: z.enum(POST_CHANNELS), ref: col.text, picture: col.textOrNull, design: col.textOrNull }),
    sql`select p.id, p.channel, p.ref, p.picture_media_id as picture,
          (select e.design_id from commerce.design_edits e
           where e.post_id = p.id and e.account_id = ${owner.accountId}::uuid and e.provider = 'canva'
           order by e.created_at desc limit 1) as design
        from commerce.social_posts p where p.store_id = ${member.store.id}::uuid and p.id = ${postId}::uuid`,
  );
  if (!post) return { ok: false, problem: "gone" };
  const target: EditTarget = { place: "post", postId: post.id };
  // A design Canva no longer opens for this person (deleted, or not theirs) is passed over for the picture itself.
  const passOver = (outcome: CanvaOutcome<{ url: string; editId: string }>) => !outcome.ok && (outcome.problem === "gone" || outcome.problem === "canva");
  if (post.design) {
    const reopened = await reopenCanvaDesign(owner, post.design, post.picture, target, deps);
    if (!passOver(reopened)) return reopened;
  }
  if (post.picture) {
    const fromLibrary = await startCanvaEdit(owner, post.picture, deps, target);
    if (!passOver(fromLibrary)) return fromLibrary;
  }
  const bytes = await (deps.draw ?? drawPicture)(member, post.id, origin);
  if (!bytes) return { ok: false, problem: "unreadable" };
  const size = PICTURE_SIZES[post.channel];
  return sendToCanva(owner, { bytes, fileName: pictureFileName(post.channel, post.ref), width: size.width, height: size.height, sourceMediaId: null }, target, deps);
}

/** *Use the drawn picture*: the post shows the picture drawn by code again; the copy from Canva stays in the library. */
export async function usePostDrawnPicture(member: Membership, postId: string): Promise<CanvaOutcome<{ postId: string }>> {
  if (!z.uuid().safeParse(postId).success) return { ok: false, problem: "gone" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`update commerce.social_posts set picture_media_id = null where store_id = ${member.store.id}::uuid and id = ${postId}::uuid returning id`,
  );
  if (!row) return { ok: false, problem: "gone" };
  await audit(member.account.id, member.store.id, "store.social_picture_drawn", { postId: row.id });
  return { ok: true, postId: row.id };
}
