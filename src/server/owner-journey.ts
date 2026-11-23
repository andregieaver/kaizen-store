import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { storeZoneOf } from "@/lib/dates";
import { renderEmail } from "@/lib/email-layout";
import { JOURNEY_PATHS, JOURNEY_STEPS, journeyWords, type JourneyStep } from "@/lib/owner-journey";
import { siteUrl } from "@/lib/site";

import { jobReport } from "./cache-events";
import { sendEmail } from "./email";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The emails that guide a store's owner from trial to plan (email plan M4.5, D886, `docs/owner-journey.md`): six service emails about their
 * own store, each once per store, to its first active owner, read from the store's state by the five-minute dispatcher's `ownerJourney`.
 * Each step looks back two days only, and the email's key (`owner-journey:{step}:{store}`) keeps it to one, so a missed run sends late,
 * never twice. An owner who turned them off under Billing (`accounts.owner_journey_off_at`) gets none. Never a template, a demo, a sandbox
 * or Kaizena Flow's own store.
 */

/** Emails a run sends at most; the rest wait for the next run. */
const PER_RUN = 50;

const DUE = z.object({
  step: z.enum(JOURNEY_STEPS),
  store_id: col.uuid,
  slug: col.text,
  store: col.text,
  time_zone: col.textOrNull,
  email: col.text,
  lang: col.textOrNull,
  trial_ends_at: col.timestampOrNull,
});

/**
 * Every step due now, in one statement: each store's first active owner who has not turned the emails off, the step's condition over its
 * plan (`commerce.store_plans`) and its state, and no email with the step's key yet.
 */
function dueSteps() {
  return typedRows(
    DUE,
    sql`
      with base as (
        select s.id as store_id, s.slug, s.name as store, s.time_zone, s.created_at, s.setup_completed_at,
               sp.status, sp.mode, sp.trial_ends_at, sp.trial_paused_at, sp.updated_at as plan_updated_at,
               o.email, o.lang
          from commerce.stores s
          left join commerce.store_plans sp on sp.store_id = s.id
          cross join lateral (
            select a.email, a.admin_locale as lang
              from commerce.store_members m join commerce.accounts a on a.id = m.account_id
             where m.store_id = s.id and m.role = 'owner' and m.disabled_at is null and a.disabled_at is null
               and a.owner_journey_off_at is null and a.email <> '' and a.email not like '%.invalid'
             order by m.created_at limit 1
          ) o
         where not (s.is_template or s.starter or s.sandbox or s.house) and s.created_at > now() - interval '365 days'
      ), due as (
        select 'trial_started' as step, b.* from base b
         where b.trial_ends_at > now() + interval '12 days' and coalesce(b.status, '') not in ('active', 'past_due') and b.created_at > now() - interval '2 days'
        union all
        select 'store_published', b.* from base b where b.setup_completed_at > now() - interval '2 days'
        union all
        select 'first_order', b.* from base b
         where exists (select 1 from commerce.orders x where x.store_id = b.store_id and x.status in ('paid', 'fulfilled', 'closed') and x.placed_at > now() - interval '2 days')
           and not exists (select 1 from commerce.orders x where x.store_id = b.store_id and x.status in ('paid', 'fulfilled', 'closed') and x.placed_at <= now() - interval '2 days')
        union all
        select 'trial_ending', b.* from base b
         where b.trial_ends_at between now() + interval '2 days' and now() + interval '3 days' and coalesce(b.status, '') not in ('active', 'past_due', 'trialing')
        union all
        select 'plan_paid', b.* from base b where b.status = 'active' and b.mode = 'live' and b.plan_updated_at > now() - interval '2 days'
        union all
        select 'store_paused', b.* from base b where b.trial_paused_at > now() - interval '2 days'
      )
      select d.step, d.store_id, d.slug, d.store, d.time_zone, d.email, d.lang, d.trial_ends_at
        from due d
       where not exists (select 1 from commerce.email_messages e where e.idempotency_key = 'owner-journey:' || d.step || ':' || d.store_id)
       order by d.store_id, d.step
       limit ${PER_RUN}
    `,
  );
}

/** One step's email to the owner, in their admin language, its button to the right page of the store's admin. */
export function journeyEmail(step: JourneyStep, facts: { slug: string; store: string; lang: string | null; trialEndsAt: string | null; timeZone: string }) {
  const words = journeyWords(facts.lang);
  const locale = facts.lang?.startsWith("nb") ? "nb-NO" : "en-GB";
  const date = facts.trialEndsAt ? new Date(facts.trialEndsAt).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: facts.timeZone }) : null;
  const w = words.steps[step]({ store: facts.store, date });
  const admin = `${siteUrl()}/admin/${facts.slug}`;
  return renderEmail({
    subject: w.subject,
    preview: w.text[0] ?? w.heading,
    blocks: [
      { type: "heading", text: w.heading },
      ...w.text.map((text) => ({ type: "paragraph" as const, text })),
      { type: "button", text: w.button, url: `${admin}${JOURNEY_PATHS[step]}` },
    ],
    footer: [words.why(facts.store)],
    unsubscribe: { text: "", linkText: words.turnOff, url: `${admin}/billing` },
    lang: locale.slice(0, 2),
  });
}

/** The dispatcher's `ownerJourney`: each due step's email, once; returns how many went. A failed send is reported and the rest go on. */
export async function sendOwnerJourney(): Promise<number> {
  const report = jobReport();
  let sent = 0;
  for (const due of await dueSteps()) {
    try {
      const outcome = await sendEmail({
        storeId: null,
        kind: "platform.owner_journey",
        to: due.email,
        email: journeyEmail(due.step, { slug: due.slug, store: due.store, lang: due.lang, trialEndsAt: due.trial_ends_at, timeZone: storeZoneOf(due.time_zone) }),
        fromName: "Kaizena Flow",
        idempotencyKey: `owner-journey:${due.step}:${due.store_id}`,
      });
      if (outcome === "sent" || outcome === "logged") sent += 1;
    } catch (error) {
      report(error, `owner-journey.${due.step}`);
    }
  }
  return sent;
}

/** Whether the owner turned the journey's emails off. */
export async function ownerJourneyOff(accountId: string): Promise<boolean> {
  const row = await typedRow(z.object({ off: col.bool }), sql`select owner_journey_off_at is not null as off from commerce.accounts where id = ${accountId}::uuid`);
  return row?.off ?? false;
}

/** Turns the journey's emails off for the owner, or on again. */
export async function setOwnerJourneyOff(accountId: string, off: boolean): Promise<void> {
  await typedRow(
    z.object({ id: col.uuid }),
    sql`update commerce.accounts set owner_journey_off_at = ${off ? sql`now()` : sql`null`} where id = ${accountId}::uuid returning id`,
  );
}
