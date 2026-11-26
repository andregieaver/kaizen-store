import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { storeExtensionOn } from "@/lib/extensions";
import { DAY_POSTS_MAX, nextTry, QUEUE_TRIES_MAX } from "@/lib/social-queue";
import { quietEnds, readSocialRules, rulesProblem } from "@/lib/social-rules";
import { siteUrl } from "@/lib/site";

import { actingAs } from "./actor";
import { skipWhilePaused } from "./ai-pause";
import { activeAccount, passMembership } from "./auth";
import { jobReport } from "./cache-events";
import { log } from "./log";
import { memberCan } from "./permissions";
import { publishSocialPost, type PublishDeps } from "./social-publish";
import { postRuleFacts, queueByRules } from "./social-rules";
import { col, typedRows } from "./typed-rows";

/**
 * The posting queue's job (D870 S3.2, from the five-minute dispatcher; scheduling in `src/server/social-queue.ts`): each approved post whose
 * moment has come is published by `publishSocialPost()`, as the person who queued it, their membership and marketing permission read again,
 * and only while the store has the social media manager. At most `DAY_POSTS_MAX` a day per channel; a refusal waits (`nextTry()`) and the
 * queue gives up after `QUEUE_TRIES_MAX`, the post then waiting for a person's *Post now*, Meta's words on it. Never throws.
 *
 * Posting by the owner's rules (S3.3): first `queueByRules()` approves and queues what the rules allow; a post they queued is then read again
 * when it is due (the switch still on and the owner who switched it on still the owner, outside the quiet hours, within the rules' posts a
 * day, its product still on sale and in stock) and published as the autopilot. While a platform admin has paused AI that acts on its own
 * (PSI AST-07), the rules queue nothing and their posts wait.
 */

const PER_RUN = 10;

const DUE = z.object({
  id: col.uuid,
  store_id: col.uuid,
  slug: col.text,
  channel: col.text,
  by: col.uuid.nullable(),
  tries: col.int,
  posted_today: col.int,
  by_rules: col.bool,
  rules_today: col.int,
  time_zone: col.text,
  social: z.unknown(),
});

const HAND_BACK = "Who queued this post can no longer post for the store. Post it by hand.";

export async function runSocialQueue(now = new Date(), deps: PublishDeps = {}): Promise<{ published: number; failed: number; waiting: number }> {
  const report = jobReport();
  const outcome = { published: 0, failed: 0, waiting: 0 };
  const paused = await skipWhilePaused("social_queue");
  if (!paused) {
    try {
      await queueByRules(now);
    } catch (error) {
      report(error, "rules");
    }
  }
  const due = await typedRows(
    DUE,
    sql`
      select p.id, p.store_id, s.slug, p.channel, p.scheduled_by as by, p.publish_tries as tries,
        (select count(*)::int from commerce.social_posts q
          where q.store_id = p.store_id and q.channel = p.channel and q.published_at >= now() - interval '24 hours') as posted_today,
        p.rules_queued_at is not null as by_rules, s.time_zone, a.social,
        (select count(*)::int from commerce.social_posts q
          where q.store_id = p.store_id and q.channel = p.channel and q.rules_queued_at is not null and q.published_at >= now() - interval '24 hours') as rules_today
      from commerce.social_posts p join commerce.stores s on s.id = p.store_id
      left join commerce.autopilot_settings a on a.store_id = p.store_id
      where p.scheduled_for is not null and p.scheduled_for <= ${now.toISOString()}::timestamptz and p.published_at is null
        and p.approved_at is not null and p.publish_tries < ${QUEUE_TRIES_MAX}
        and (p.next_try_at is null or p.next_try_at <= ${now.toISOString()}::timestamptz)
        and (p.publish_started_at is null or p.publish_started_at < now() - interval '5 minutes')
        and commerce.store_is_active(p.store_id) ${paused ? sql`and p.rules_queued_at is null` : sql``}
      order by p.scheduled_for
      limit ${PER_RUN}
    `,
  );
  for (const post of due) {
    try {
      const account = post.by ? await activeAccount(post.by) : null;
      const member = account ? await passMembership(post.slug, account.id) : null;
      const rules = readSocialRules(post.social);
      // A post the rules queued goes out only while they are on and the owner who switched them on is still the owner.
      const rulesHold = post.by_rules && (!rules.on || rules.by !== post.by || !member || !memberCan(member, "owner"));
      if (!member || !memberCan(member, "marketing:write") || !storeExtensionOn(member.store, "social", now) || rulesHold) {
        // Whoever queued it can no longer post for the store (or the store has no social media manager): it waits for a person.
        await handBack(post.store_id, post.id, post.by_rules, HAND_BACK);
        outcome.failed += 1;
        continue;
      }
      if (post.by_rules) {
        const quiet = quietEnds(now, post.time_zone, rules);
        const full = post.rules_today >= rules.postsPerDay;
        if (quiet || full) {
          // The quiet hours, or the rules' posts for the day: it waits, without counting as a refusal.
          const until = quiet ?? new Date(now.getTime() + 3 * 3_600_000);
          await db().execute(sql`update commerce.social_posts set next_try_at = ${until.toISOString()}::timestamptz where store_id = ${post.store_id}::uuid and id = ${post.id}::uuid`);
          outcome.waiting += 1;
          continue;
        }
        // Checked again at posting time: a product sold out or taken off sale since it was queued sends the post back to a person.
        const facts = await postRuleFacts(post.store_id, post.id);
        const problem = facts ? rulesProblem({ ...facts, held: false }) : HAND_BACK;
        if (problem) {
          await handBack(post.store_id, post.id, true, problem);
          outcome.failed += 1;
          continue;
        }
      }
      if (post.posted_today >= DAY_POSTS_MAX) {
        // The channel's day is full: try again in a few hours, without counting it as a refusal.
        await db().execute(sql`update commerce.social_posts set next_try_at = ${new Date(now.getTime() + 3 * 3_600_000).toISOString()}::timestamptz where store_id = ${post.store_id}::uuid and id = ${post.id}::uuid`);
        outcome.waiting += 1;
        continue;
      }
      const result = post.by_rules
        ? await actingAs("autopilot", () => publishSocialPost(member, post.id, siteUrl(), deps))
        : await publishSocialPost(member, post.id, siteUrl(), deps);
      if (result.ok) {
        outcome.published += 1;
        continue;
      }
      const tries = post.tries + 1;
      const again = nextTry(tries, now);
      await db().execute(sql`
        update commerce.social_posts set publish_tries = ${tries}, next_try_at = ${again ? again.toISOString() : null}::timestamptz
        where store_id = ${post.store_id}::uuid and id = ${post.id}::uuid`);
      outcome.failed += 1;
    } catch (error) {
      report(error, "post");
      log("error", "social.queue_failed", { post: post.id }, error);
    }
  }
  return outcome;
}

/**
 * Takes a post off the queue with the reason on it; one the rules queued also loses the rules' yes and is held, so the rules leave it and it
 * waits for a person's.
 */
async function handBack(storeId: string, postId: string, byRules: boolean, problem: string): Promise<void> {
  await db().execute(sql`
    update commerce.social_posts set scheduled_for = null, publish_problem = ${problem}
      ${byRules ? sql`, approved_at = null, approved_by = null, scheduled_by = null, rules_queued_at = null, next_try_at = null, held_at = now()` : sql``}
    where store_id = ${storeId}::uuid and id = ${postId}::uuid`);
}
