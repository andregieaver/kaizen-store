import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { challengeOn, readChallenge, utcDay } from "@/lib/autopilot-challenge";
import { DECISION_HOURS, ESCALATION_HOURS, FAULT_MINUTES, stallKey, type Stall } from "@/lib/challenge-stalls";
import { renderEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";

import { aiBudgetProblem, autonomyFor } from "./autopilot-settings";
import { sendEmail } from "./email";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * The stall watch (`docs/100-day-challenge.md` A6): every challenge store's stalls (`STALL_KINDS`), found in SQL, and each told to the platform
 * team by email at once, once a day while it lasts (`stallKey()`). The dispatcher's job `challengeStalls`. Never throws.
 */

const STORE = z.object({ id: col.uuid, slug: col.text, name: col.text, challenge: z.unknown(), paused: col.bool });
const COUNTED = z.object({ ref: col.text, n: col.int });

/** The stalls of every store with challenge mode on now. */
export async function findChallengeStalls(now: Date = new Date()): Promise<Stall[]> {
  const stores = (
    await typedRows(
      STORE,
      sql`select s.id, s.slug, s.name, a.challenge, a.paused from commerce.autopilot_settings a join commerce.stores s on s.id = a.store_id where a.challenge is not null`,
    )
  ).filter((s) => challengeOn(readChallenge(s.challenge), utcDay(now)));
  const at = now.toISOString();
  const stalls: Stall[] = [];
  for (const store of stores) {
    const add = (kind: Stall["kind"], ref: string, count = 1) => stalls.push({ storeId: store.id, storeName: store.name, storeSlug: store.slug, kind, ref, count });
    if (store.paused) add("paused", "store");
    if (await aiBudgetProblem(store.id, await autonomyFor(store.id, now))) add("budget", utcDay(now).slice(0, 7));
    const [decisions, plans, asking, faults, escalations] = await Promise.all([
      typedRows(
        COUNTED,
        sql`
          select min(ap.id::text) as ref, count(*)::int as n from commerce.assistant_approvals ap
          join commerce.assistant_conversations c on c.id = ap.conversation_id and c.source = 'autopilot'
          where ap.store_id = ${store.id}::uuid and ap.status = 'pending' and ap.created_at < ${at}::timestamptz - make_interval(hours => ${DECISION_HOURS})
          having count(*) > 0
        `,
      ),
      typedRows(COUNTED, sql`select id::text as ref, 1 as n from commerce.assistant_plans where store_id = ${store.id}::uuid and status = 'paused' and paused_for is null`),
      typedRows(COUNTED, sql`select plan_id::text as ref, count(*)::int as n from commerce.assistant_plan_steps where store_id = ${store.id}::uuid and status = 'asking' group by plan_id`),
      typedRows(
        COUNTED,
        sql`
          select id::text as ref, 1 as n from commerce.support_conversations
          where store_id = ${store.id}::uuid and status = 'open' and handler = 'queue' and anonymised_at is null and handoff_reason in ('no_ai', 'limit')
            and queued_at < ${at}::timestamptz - make_interval(mins => ${FAULT_MINUTES})
        `,
      ),
      typedRows(
        COUNTED,
        sql`
          select min(id::text) as ref, count(*)::int as n from commerce.support_conversations
          where store_id = ${store.id}::uuid and status = 'open' and handler = 'queue' and anonymised_at is null and handoff_reason in ('customer', 'ai', 'tone')
            and queued_at < ${at}::timestamptz - make_interval(hours => ${ESCALATION_HOURS})
          having count(*) > 0
        `,
      ),
    ]);
    for (const d of decisions) add("decision_waiting", d.ref, d.n);
    for (const p of plans) add("plan_paused", p.ref);
    for (const q of asking) add("asking", q.ref, q.n);
    for (const f of faults) add("support_fault", f.ref);
    for (const e of escalations) add("escalation_waiting", e.ref, e.n);
  }
  return stalls;
}

/** Tells the platform admins of each stall, in their language, once a day while it lasts. Returns the emails sent. */
export async function sendChallengeStallAlerts(now: Date = new Date()): Promise<number> {
  let sent = 0;
  try {
    const stalls = await findChallengeStalls(now);
    if (stalls.length === 0) return 0;
    const admins = await typedRows(
      z.object({ id: col.uuid, email: col.text, admin_locale: col.textOrNull }),
      sql`select id, email, admin_locale from commerce.accounts where platform_admin and disabled_at is null and email <> ''`,
    );
    const day = utcDay(now);
    for (const stall of stalls) {
      for (const admin of admins) {
        const lang = adminLangOf(admin.admin_locale);
        const words = STAFF_EMAILS_WORDS[lang];
        const w = words.challengeStall;
        const values = { store: stall.storeName, count: String(stall.count) };
        const what = fillWords(w.kinds[stall.kind], values);
        const email = renderEmail({
          subject: fillWords(w.subject, { ...values, what }),
          preview: what,
          lang: ADMIN_LANG_FACTS[lang].tag,
          footer: [words.footer],
          blocks: [
            { type: "heading", text: fillWords(w.heading, values) },
            { type: "paragraph", text: what },
            { type: "paragraph", text: w.after },
            { type: "button", text: w.button, url: `${siteUrl()}/admin/${stall.storeSlug}/assistant/autopilot` },
          ],
        });
        const outcome = await sendEmail({
          storeId: null,
          kind: "platform.challenge_stall",
          to: admin.email,
          email,
          fromName: "Kaizena Flow",
          idempotencyKey: `${stallKey(stall, day)}:${admin.id}`,
        });
        if (outcome === "sent" || outcome === "logged") sent++;
      }
    }
  } catch (error) {
    log("error", "challenge.stall_alerts_failed", {}, error);
  }
  return sent;
}
