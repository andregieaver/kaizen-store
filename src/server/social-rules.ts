import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { scheduleFor } from "@/lib/social-queue";
import { quietEnds, readSocialRules, rulesProblem, socialRulesInput, type SocialRules } from "@/lib/social-rules";

import { audit, type Membership } from "./auth";
import type { Store } from "./stores";
import { memberCan } from "./permissions";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * *Post on its own within my rules* (D870 S3.3, the rule in `src/lib/social-rules.ts`): the owner's switch and limits, kept on the store's
 * `autopilot_settings.social` (the only writer), and the queue's pass that approves and queues the posts the rules allow
 * (`queueByRules()`, run by the posting queue's job before it posts). Switching it off hands every post the rules queued and not yet out back
 * to a person, at once. Loads no publishing.
 */

/** The store's rules (off when none were set). */
export async function socialRulesOf(storeId: string): Promise<SocialRules> {
  const row = await typedRow(z.object({ social: z.unknown() }), sql`select social from commerce.autopilot_settings where store_id = ${storeId}::uuid`);
  return readSocialRules(row?.social);
}

/** Saves the switch and limits: an owner's alone, audited. Switched off, the posts the rules queued go back to waiting for a yes. */
export async function saveSocialRules(member: Membership, raw: unknown): Promise<{ ok: true; rules: SocialRules; handedBack: number } | { ok: false; problem: string }> {
  if (!memberCan(member, "owner")) return { ok: false, problem: "Only an owner decides whether posts go out on their own." };
  const parsed = socialRulesInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "The rules could not be read." };
  const rules: SocialRules = { ...parsed.data, by: parsed.data.on ? member.account.id : null };
  const { store } = member;
  await db().execute(sql`
    insert into commerce.autopilot_settings (store_id, social, updated_by, updated_at) values (${store.id}::uuid, ${JSON.stringify(rules)}::jsonb, ${member.account.id}::uuid, now())
    on conflict (store_id) do update set social = excluded.social, updated_by = excluded.updated_by, updated_at = now()`);
  const handedBack = rules.on ? 0 : await handBack(store.id);
  await audit(member.account.id, store.id, "store.social_rules", { on: rules.on, postsPerDay: rules.postsPerDay, quietFrom: rules.quietFrom, quietTo: rules.quietTo, handedBack });
  return { ok: true, rules, handedBack };
}

/** Every post the rules queued and not yet out, back to waiting for a person's yes. */
async function handBack(storeId: string): Promise<number> {
  const rows = await db().execute(sql`
    update commerce.social_posts set approved_at = null, approved_by = null, scheduled_for = null, scheduled_by = null, next_try_at = null, rules_queued_at = null
    where store_id = ${storeId}::uuid and rules_queued_at is not null and published_at is null and publish_started_at is null returning id`);
  return rows.length;
}

const CANDIDATE = z.object({
  id: col.uuid,
  store_id: col.uuid,
  day: col.text,
  time_zone: col.text,
  social: z.unknown(),
  checked: col.bool,
  problems: z.array(z.string()),
  has_product: col.bool,
  active: col.bool,
  can_buy: col.bool,
});

/**
 * Approves and queues, for each store whose rules are on, the posts planned for today and tomorrow (in its time) that the rules allow and
 * that have a channel the store may post to: as the owner who switched the rules on, at the planned day's posting hour. The number queued.
 */
export async function queueByRules(now = new Date()): Promise<number> {
  const rows = await typedRows(
    CANDIDATE,
    sql`
      select p.id, p.store_id, p.planned_for::text as day, s.time_zone, a.social,
        p.checked_at is not null as checked, p.check_problems as problems, p.product_id is not null as has_product,
        coalesce(pr.status = 'active', false) as active,
        exists (select 1 from commerce.product_variants v join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
                where v.store_id = p.store_id and v.product_id = p.product_id and va.can_buy) as can_buy
      from commerce.social_posts p
      join commerce.stores s on s.id = p.store_id
      join commerce.autopilot_settings a on a.store_id = p.store_id and a.social ->> 'on' = 'true'
      left join commerce.products pr on pr.store_id = p.store_id and pr.id = p.product_id
      where p.approved_at is null and p.held_at is null and p.published_at is null and p.publish_started_at is null
        and p.planned_for between (${now.toISOString()}::timestamptz at time zone s.time_zone)::date and (${now.toISOString()}::timestamptz at time zone s.time_zone)::date + 1
        and commerce.store_is_active(p.store_id)
        and ((p.channel = 'instagram' and exists (select 1 from commerce.instagram_accounts i where (i.store_id = p.store_id or (s.house and i.store_id is null)) and i.publish and i.token_expires_at > now()))
          or (p.channel = 'facebook' and exists (select 1 from commerce.facebook_pages f where f.store_id = p.store_id and f.publish and f.page_id is not null))
          or (p.channel = 'pinterest' and exists (select 1 from commerce.pinterest_accounts t where t.store_id = p.store_id and t.publish and t.board_id is not null and t.refresh_expires_at > now()))
          or (p.channel = 'tiktok' and p.video_media_id is not null and exists (select 1 from commerce.tiktok_accounts k where k.store_id = p.store_id and k.publish and k.refresh_expires_at > now())))
      order by p.planned_for, p.created_at
      limit 50
    `,
  );
  let queued = 0;
  for (const post of rows) {
    const rules = readSocialRules(post.social);
    if (!rules.on || !rules.by) continue;
    const problem = rulesProblem({ checked: post.checked, problems: post.problems, held: false, product: post.has_product ? { active: post.active, canBuy: post.can_buy } : null });
    if (problem) continue;
    const at = scheduleFor(post.day, post.time_zone, now);
    if (!at) continue;
    const changed = await db().execute(sql`
      update commerce.social_posts set approved_at = now(), approved_by = null, scheduled_for = ${at.toISOString()}::timestamptz, scheduled_by = ${rules.by}::uuid,
        rules_queued_at = now(), publish_tries = 0, next_try_at = null, publish_problem = null
      where store_id = ${post.store_id}::uuid and id = ${post.id}::uuid and approved_at is null and held_at is null and published_at is null returning id`);
    queued += changed.length;
  }
  return queued;
}

/** A post's facts for the rules at posting time: its check and its product's state now. */
export async function postRuleFacts(storeId: string, postId: string): Promise<{ checked: boolean; problems: string[]; product: { active: boolean; canBuy: boolean } | null } | null> {
  const row = await typedRow(
    z.object({ checked: col.bool, problems: z.array(z.string()), has_product: col.bool, active: col.bool, can_buy: col.bool }),
    sql`
      select p.checked_at is not null as checked, p.check_problems as problems, p.product_id is not null as has_product, coalesce(pr.status = 'active', false) as active,
        exists (select 1 from commerce.product_variants v join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
                where v.store_id = p.store_id and v.product_id = p.product_id and va.can_buy) as can_buy
      from commerce.social_posts p left join commerce.products pr on pr.store_id = p.store_id and pr.id = p.product_id
      where p.store_id = ${storeId}::uuid and p.id = ${postId}::uuid`,
  );
  if (!row) return null;
  return { checked: row.checked, problems: row.problems, product: row.has_product ? { active: row.active, canBuy: row.can_buy } : null };
}

/**
 * Whether the autopilot may ask for an approved post to go out now without the owner's yes (`publish_social_post`, `autonomyDecision()`): only
 * while the rules are on, outside the quiet hours, and for a post they allow. Why not, in words, or null.
 */
export async function socialRulesAutopilotProblem(store: Pick<Store, "id" | "timeZone">, postId: string): Promise<string | null> {
  const rules = await socialRulesOf(store.id);
  if (!rules.on) return "Posting on its own is off: switch on Post on its own within my rules on Social posts.";
  if (quietEnds(new Date(), store.timeZone, rules)) return "It is the quiet hours you set for posting.";
  const id = z.uuid().safeParse(postId);
  const facts = id.success ? await postRuleFacts(store.id, id.data) : null;
  if (!facts) return "That post is not this store's.";
  return rulesProblem({ ...facts, held: false });
}
