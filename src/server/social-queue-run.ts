import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { storeExtensionOn } from "@/lib/extensions";
import { DAY_POSTS_MAX, nextTry, QUEUE_TRIES_MAX } from "@/lib/social-queue";
import { siteUrl } from "@/lib/site";

import { activeAccount, passMembership } from "./auth";
import { jobReport } from "./cache-events";
import { log } from "./log";
import { memberCan } from "./permissions";
import { publishSocialPost, type PublishDeps } from "./social-publish";
import { col, typedRows } from "./typed-rows";

/**
 * The posting queue's job (D870 S3.2, from the five-minute dispatcher; scheduling in `src/server/social-queue.ts`): each approved post whose
 * moment has come is published by `publishSocialPost()`, as the person who queued it, their membership and marketing permission read again,
 * and only while the store has the social media manager. At most `DAY_POSTS_MAX` a day per channel; a refusal waits (`nextTry()`) and the
 * queue gives up after `QUEUE_TRIES_MAX`, the post then waiting for a person's *Post now*, Meta's words on it. Never throws.
 */

const PER_RUN = 10;

const DUE = z.object({ id: col.uuid, store_id: col.uuid, slug: col.text, channel: col.text, by: col.uuid.nullable(), tries: col.int, posted_today: col.int });

export async function runSocialQueue(now = new Date(), deps: PublishDeps = {}): Promise<{ published: number; failed: number; waiting: number }> {
  const report = jobReport();
  const outcome = { published: 0, failed: 0, waiting: 0 };
  const due = await typedRows(
    DUE,
    sql`
      select p.id, p.store_id, s.slug, p.channel, p.scheduled_by as by, p.publish_tries as tries,
        (select count(*)::int from commerce.social_posts q
          where q.store_id = p.store_id and q.channel = p.channel and q.published_at >= now() - interval '24 hours') as posted_today
      from commerce.social_posts p join commerce.stores s on s.id = p.store_id
      where p.scheduled_for is not null and p.scheduled_for <= ${now.toISOString()}::timestamptz and p.published_at is null
        and p.approved_at is not null and p.publish_tries < ${QUEUE_TRIES_MAX}
        and (p.next_try_at is null or p.next_try_at <= ${now.toISOString()}::timestamptz)
        and (p.publish_started_at is null or p.publish_started_at < now() - interval '5 minutes')
        and commerce.store_is_active(p.store_id)
      order by p.scheduled_for
      limit ${PER_RUN}
    `,
  );
  for (const post of due) {
    try {
      const account = post.by ? await activeAccount(post.by) : null;
      const member = account ? await passMembership(post.slug, account.id) : null;
      if (!member || !memberCan(member, "marketing:write") || !storeExtensionOn(member.store, "social", now)) {
        // Whoever queued it can no longer post for the store (or the store has no social media manager): it waits for a person.
        await db().execute(sql`
          update commerce.social_posts set scheduled_for = null, publish_problem = 'Who queued this post can no longer post for the store. Post it by hand.'
          where store_id = ${post.store_id}::uuid and id = ${post.id}::uuid`);
        outcome.failed += 1;
        continue;
      }
      if (post.posted_today >= DAY_POSTS_MAX) {
        // The channel's day is full: try again in a few hours, without counting it as a refusal.
        await db().execute(sql`update commerce.social_posts set next_try_at = ${new Date(now.getTime() + 3 * 3_600_000).toISOString()}::timestamptz where store_id = ${post.store_id}::uuid and id = ${post.id}::uuid`);
        outcome.waiting += 1;
        continue;
      }
      const result = await publishSocialPost(member, post.id, siteUrl(), deps);
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
