import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { AVOIDED_LABEL } from "@/lib/brand";
import { CLAIM_LABELS } from "@/lib/claims";
import { addDays, startOfWeek } from "@/lib/analytics-period";
import { CALENDAR_WEEKS, socialCalendar, type CalendarDraft, type CalendarWeek } from "@/lib/social-calendar";
import type { CalendarSlot } from "@/lib/social-advice";
import { CHANNEL_SPECS, POST_CHANNELS, postClaims } from "@/lib/social-posts";

import { audit, type Membership } from "./auth";
import { brandOf } from "./brand";
import { memberCan, NO_ACCESS } from "./permissions";
import { col, typedRows } from "./typed-rows";

/**
 * The social calendar's reads and writes (D870 S2.4, the pure work in `src/lib/social-calendar.ts`): the drafts planned for the calendar's
 * two weeks, a person's yes to posts (one, or a week's at once) and taking it back, and a draft's caption changed by hand, which goes through
 * the same claims filter as the writer and takes back its yes. Phase 3 publishes only approved posts.
 */

const DRAFT_ROW = z.object({
  id: col.uuid,
  day: col.text,
  channel: z.enum(POST_CHANNELS),
  caption: col.text,
  approved: col.bool,
  product_id: z.string().nullable(),
  topic: col.text,
  edited_at: col.timestampOrNull,
  checked_at: col.timestampOrNull,
  check_problems: z.array(z.string()),
  check_note: col.text,
  scene: col.bool,
  scene_tries: col.int,
  video: col.textOrNull,
  published_at: col.timestampOrNull,
  published_url: col.textOrNull,
  publish_problem: col.textOrNull,
  scheduled_for: col.timestampOrNull,
  by_rules: col.bool,
});

/** The calendar of the store's two weeks from today's Monday: the advice's plan and the drafts written for its days. */
export async function calendarOf(storeId: string, today: string, slots: readonly CalendarSlot[]): Promise<CalendarWeek[]> {
  const first = startOfWeek(today);
  const rows = await typedRows(
    DRAFT_ROW,
    sql`
      select p.id, p.planned_for::text as day, p.channel, p.caption, p.approved_at is not null as approved, p.product_id, p.topic, p.edited_at, p.checked_at, p.check_problems, p.check_note, p.scene_media_id is not null as scene, p.scene_tries, v.url as video, p.published_at, p.published_url, p.publish_problem, p.scheduled_for, p.rules_queued_at is not null as by_rules
      from commerce.social_posts p left join commerce.media v on v.id = p.video_media_id and v.store_id = p.store_id
      where p.store_id = ${storeId}::uuid and p.planned_for between ${first}::date and ${addDays(first, CALENDAR_WEEKS * 7 - 1)}::date
      order by p.created_at desc
    `,
  );
  const drafts: CalendarDraft[] = rows.map((r) => ({ id: r.id, day: r.day, channel: r.channel, caption: r.caption, approved: r.approved, productId: r.product_id, topic: r.topic, editedAt: r.edited_at, check: r.checked_at ? { problems: r.check_problems, note: r.check_note } : null, scene: { on: r.scene, tries: r.scene_tries }, video: r.video, published: r.published_at ? { url: r.published_url } : null, publishProblem: r.publish_problem, scheduledFor: r.scheduled_for, byRules: r.by_rules }));
  return socialCalendar(today, slots, drafts);
}

const ids = z.array(z.uuid()).min(1).max(50);

/** Says yes to posts, or takes the yes back (`approve` false): the store's own posts only. The number changed. */
export async function approveSocialPosts(member: Membership, raw: unknown, approve: boolean): Promise<{ ok: true; changed: number } | { ok: false; problem: string }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = ids.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "Choose the posts to approve." };
  const list = `{${parsed.data.join(",")}}`;
  const rows = approve
    ? await db().execute(sql`
        update commerce.social_posts set approved_at = now(), approved_by = ${member.account.id}::uuid, held_at = null, rules_queued_at = null
        where store_id = ${member.store.id}::uuid and id = any(${list}::uuid[]) and (approved_at is null or rules_queued_at is not null) returning id`)
    : await db().execute(sql`
        update commerce.social_posts set approved_at = null, approved_by = null, scheduled_for = null, scheduled_by = null, next_try_at = null, rules_queued_at = null, held_at = now()
        where store_id = ${member.store.id}::uuid and id = any(${list}::uuid[]) and approved_at is not null and published_at is null and publish_started_at is null returning id`);
  if (rows.length > 0) await audit(member.account.id, member.store.id, approve ? "store.social_posts_approved" : "store.social_posts_unapproved", { posts: rows.length });
  return { ok: true, changed: rows.length };
}

const edit = z.object({ id: z.uuid(), caption: z.string().trim().min(1, "Write the post's words.") });

/**
 * A draft's words changed by hand: within its channel's length, and through the claims filter and the brand's words to avoid, as the writer's
 * are (a price, an urgency or a claim stays code's or out). The change takes back the post's yes.
 */
export async function editSocialPost(member: Membership, raw: unknown): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = edit.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Write the post's words." };
  const [post] = await typedRows(
    z.object({ channel: z.enum(POST_CHANNELS), title: col.text, hashtags: z.array(z.string()), published: col.bool }),
    sql`select channel, title, hashtags, published_at is not null or publish_started_at is not null as published from commerce.social_posts where store_id = ${member.store.id}::uuid and id = ${parsed.data.id}::uuid`,
  );
  if (!post) return { ok: false, problem: "That post is not this store's." };
  // A published post is the one people saw (D870 S3.1): its words stay as they went out.
  if (post.published) return { ok: false, problem: "This post is published: its words can no longer change." };
  const caption = parsed.data.caption;
  const max = CHANNEL_SPECS[post.channel].maxChars;
  if (caption.length > max) return { ok: false, problem: `${CHANNEL_SPECS[post.channel].label} takes at most ${max} characters.` };
  const brand = await brandOf(member.store.id);
  const claims = postClaims({ title: post.title, caption, hashtags: post.hashtags }, brand.avoid);
  if (claims.length > 0) {
    const found = [...new Set(claims.map((c) => `${(c.kind === "avoided" ? AVOIDED_LABEL : CLAIM_LABELS[c.kind]).toLowerCase()} ("${c.phrase}")`))].join(", ");
    return { ok: false, problem: `The words make claims the shop does not make in posts: ${found}.` };
  }
  await db().execute(sql`
    update commerce.social_posts set caption = ${caption}, edited_at = now(), approved_at = null, approved_by = null, scheduled_for = null, scheduled_by = null,
      checked_at = null, check_problems = '{}', check_note = ''
    where store_id = ${member.store.id}::uuid and id = ${parsed.data.id}::uuid`);
  await audit(member.account.id, member.store.id, "store.social_post_edited", {});
  return { ok: true };
}
