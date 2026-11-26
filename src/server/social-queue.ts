import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { scheduleFor } from "@/lib/social-queue";

import { audit, type Membership } from "./auth";
import { memberCan, NO_ACCESS } from "./permissions";
import { col, typedRows } from "./typed-rows";

/**
 * Scheduling for the posting queue (D870 S3.2, rules in `src/lib/social-queue.ts`): an approved post on Instagram or Facebook is queued for
 * its planned day, a person may take it off the queue or put it back, and the AI manager's request (on the owner's yes) queues one for now.
 * The dispatcher's job that publishes is `src/server/social-queue-run.ts`. This module loads no publishing, so the manager's tools, which
 * the shop's functions load, stay light (ci-red #66). The writer of `scheduled_for` and `scheduled_by`, with the clearing in the calendar's
 * writers when a post's yes is taken back.
 */

const ROW = z.object({ id: col.uuid, day: col.textOrNull });
const ids = z.array(z.uuid()).min(1).max(50);

/**
 * Queues the approved, unpublished posts named for their planned day (`on`), or takes them off the queue (`on` false). Only Instagram and
 * Facebook posts; a post planned for a day gone by is not queued. The number changed.
 */
export async function scheduleSocialPosts(member: Membership, raw: unknown, on: boolean, now = new Date()): Promise<{ ok: true; changed: number } | { ok: false; problem: string }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = ids.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "Choose the posts." };
  const list = `{${parsed.data.join(",")}}`;
  const { store } = member;
  if (!on) {
    const rows = await db().execute(sql`
      update commerce.social_posts set scheduled_for = null, scheduled_by = null, next_try_at = null
      where store_id = ${store.id}::uuid and id = any(${list}::uuid[]) and scheduled_for is not null and published_at is null and publish_started_at is null returning id`);
    if (rows.length > 0) await audit(member.account.id, store.id, "store.social_posts_unscheduled", { posts: rows.length });
    return { ok: true, changed: rows.length };
  }
  const posts = await typedRows(
    ROW,
    sql`select id, planned_for::text as day from commerce.social_posts
      where store_id = ${store.id}::uuid and id = any(${list}::uuid[]) and approved_at is not null and published_at is null and channel in ('instagram', 'facebook')`,
  );
  let changed = 0;
  for (const post of posts) {
    const at = scheduleFor(post.day, store.timeZone, now);
    if (!at) continue;
    await db().execute(sql`
      update commerce.social_posts set scheduled_for = ${at.toISOString()}::timestamptz, scheduled_by = ${member.account.id}::uuid, publish_tries = 0, next_try_at = null
      where store_id = ${store.id}::uuid and id = ${post.id}::uuid`);
    changed += 1;
  }
  if (changed > 0) await audit(member.account.id, store.id, "store.social_posts_scheduled", { posts: changed });
  return { ok: true, changed };
}

/**
 * The AI manager's request, run once the owner said yes (`publish_social_post`): an approved Instagram or Facebook post queued for now; the
 * dispatcher posts it within minutes. Refused for a post not approved or already out.
 */
export async function requestSocialPost(member: Membership, postId: unknown): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const id = z.uuid().safeParse(postId);
  if (!id.success) return { ok: false, problem: "Choose a post." };
  const rows = await db().execute(sql`
    update commerce.social_posts set scheduled_for = now(), scheduled_by = ${member.account.id}::uuid, publish_tries = 0, next_try_at = null
    where store_id = ${member.store.id}::uuid and id = ${id.data}::uuid and approved_at is not null and published_at is null
      and channel in ('instagram', 'facebook') returning id`);
  if (rows.length === 0) return { ok: false, problem: "That post is not approved, or it is out already, or its channel is copied by hand." };
  await audit(member.account.id, member.store.id, "store.social_post_requested", {});
  return { ok: true };
}
