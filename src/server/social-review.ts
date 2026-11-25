import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { adminLangOf } from "@/lib/admin-lang";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { addDays, customPeriod, startOfWeek, todayIn } from "@/lib/analytics-period";
import { renderEmail } from "@/lib/email-layout";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { siteUrl } from "@/lib/site";
import { REVIEW_ACTIVE_DAYS, REVIEW_HOUR, reviewWorthSending, socialReviewEmail, type ReviewFacts, type WeekFigures } from "@/lib/social-review";

import { postReport } from "./analytics-traffic-data";
import { activeAccount, passMembership } from "./auth";
import { jobReport } from "./cache-events";
import { sendEmail, type OutgoingEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { memberCan } from "./permissions";
import { latestAdvice } from "./social-advice";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The social media adviser's weekly review (D870 S1.5, the email's words and figures in `src/lib/social-review.ts`), the only writer of
 * `commerce.social_reviews`, from the five-minute dispatcher. To each person who asked the adviser in a store within the last 60 days (asking
 * is the opt-in; it stops when they stop), with their membership and its marketing permission read again: from Monday 08:00 in the store's
 * time, once a week, when the week has something to say. The week's row is claimed before its email goes, so each is sent once. No model is
 * asked: the figures are code's and the words are the newest advice's, checked when it was written.
 */

const PER_RUN = 20;

export type ReviewDeps = { now?: Date; send?: (message: OutgoingEmail) => Promise<SendOutcome> };

const RECIPIENT = z.object({ store_id: col.uuid, account_id: col.uuid, slug: col.text, time_zone: col.text });
const COUNTS = z.object({ written: col.int, copied: col.int });
const INSTAGRAM = z.object({ posts: col.int, best: col.int.nullable() });

const sum = (rows: { sessions: number; orders: number; revenueMinor: number }[]): WeekFigures => ({
  visits: rows.reduce((s, r) => s + r.sessions, 0),
  orders: rows.reduce((s, r) => s + r.orders, 0),
  revenueMinor: rows.reduce((s, r) => s + r.revenueMinor, 0),
});

/** The week's facts for a store: its own week, Monday to Sunday before `weekStart`, against the one before. */
async function factsOf(store: Store, weekStart: string, now: Date): Promise<ReviewFacts> {
  const lastDay = addDays(weekStart, -1);
  const week = customPeriod(addDays(lastDay, -6), lastDay);
  const before = customPeriod(addDays(lastDay, -13), addDays(lastDay, -7));
  const [counts, tagged, taggedBefore, instagram, advice] = await Promise.all([
    typedRow(
      COUNTS,
      sql`
      select count(distinct ref)::int as written, count(distinct ref) filter (where copied_at is not null)::int as copied
      from commerce.social_posts where store_id = ${store.id}::uuid and created_at >= ${week.from}::date and created_at < ${weekStart}::date
    `,
    ),
    postReport(store, week, now),
    postReport(store, before, now),
    typedRow(
      INSTAGRAM,
      sql`
      select count(*)::int as posts, max(i.reach)::int as best
      from commerce.social_post_insights i
      where i.store_id = ${store.id}::uuid and i.posted_at >= ${week.from}::date and i.posted_at < ${weekStart}::date
    `,
    ),
    latestAdvice(store.id),
  ]);
  const hasInstagram = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.instagram_accounts where store_id = ${store.id}::uuid and insights`);
  return {
    store: store.name,
    currency: mainCurrency(store),
    weekStart,
    posts: { written: counts?.written ?? 0, copied: counts?.copied ?? 0 },
    tagged: tagged.counting ? { week: sum(tagged.rows), before: sum(taggedBefore.rows) } : null,
    instagram: (hasInstagram?.n ?? 0) > 0 ? { posts: instagram?.posts ?? 0, bestReach: instagram?.best ?? null } : null,
    advice: advice
      ? {
          date: advice.createdAt.slice(0, 10),
          verdicts: advice.advice.verdicts,
          planned: advice.advice.calendar.filter((s) => s.day >= weekStart && s.day <= addDays(weekStart, 6)).map((s) => ({ day: s.day, channel: s.channel, idea: s.idea })),
        }
      : null,
  };
}

export async function sendSocialReviews(deps: ReviewDeps = {}): Promise<{ sent: number }> {
  const report = jobReport();
  const now = deps.now ?? new Date();
  let sent = 0;
  const recipients = await typedRows(
    RECIPIENT,
    sql`
      select distinct a.store_id, a.created_by as account_id, s.slug, s.time_zone
      from commerce.social_advice a join commerce.stores s on s.id = a.store_id
      where a.created_by is not null and a.created_at > now() - make_interval(days => ${REVIEW_ACTIVE_DAYS}) and commerce.store_is_active(a.store_id)
      limit ${PER_RUN * 5}
    `,
  );
  for (const r of recipients) {
    if (sent >= PER_RUN) break;
    try {
      const today = todayIn(now, r.time_zone);
      const weekStart = startOfWeek(today);
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: r.time_zone, hour: "2-digit", hourCycle: "h23" }).format(now));
      if (today === weekStart && hour < REVIEW_HOUR) continue;
      const done = await typedRow(
        z.object({ id: col.uuid }),
        sql`select id from commerce.social_reviews where store_id = ${r.store_id}::uuid and account_id = ${r.account_id}::uuid and week_start = ${weekStart}::date`,
      );
      if (done) continue;
      const account = await activeAccount(r.account_id);
      if (!account?.email) continue;
      const member = await passMembership(r.slug, account.id);
      if (!member || !memberCan(member, "marketing:read")) continue;
      const facts = await factsOf(member.store, weekStart, now);
      if (!reviewWorthSending(facts)) continue;
      const claimed = await typedRow(
        z.object({ id: col.uuid }),
        sql`
          insert into commerce.social_reviews (store_id, account_id, week_start, facts)
          values (${r.store_id}::uuid, ${account.id}::uuid, ${weekStart}::date, ${JSON.stringify(facts)}::jsonb)
          on conflict on constraint social_reviews_week_key do nothing
          returning id
        `,
      );
      if (!claimed) continue;
      const lang = adminLangOf(account.adminLocale ?? null);
      const locale = member.store.markets[0]?.locale ?? "en-GB";
      try {
        await (deps.send ?? sendEmail)({
          storeId: r.store_id,
          kind: "social.weekly",
          to: account.email,
          email: renderEmail(socialReviewEmail(facts, `${siteUrl()}/admin/${r.slug}/social`, STAFF_EMAILS_WORDS[lang], lang, (minor) => formatMoney(minor, facts.currency, locale))),
          fromName: "Kaizena Flow",
          idempotencyKey: `social.weekly:${r.store_id}:${account.id}:${weekStart}`,
        });
        await db().execute(sql`update commerce.social_reviews set sent_at = now() where id = ${claimed.id}::uuid and store_id = ${r.store_id}::uuid`);
      } catch (error) {
        report(error, "email");
        log("error", "social.review_email_failed", { review: claimed.id }, error);
      }
      sent += 1;
    } catch (error) {
      report(error, "review");
      log("error", "social.review_failed", { store: r.store_id, account: r.account_id }, error);
    }
  }
  return { sent };
}
