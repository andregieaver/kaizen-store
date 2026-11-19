import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { adminLangOf } from "@/lib/admin-lang";
import { renderEmail } from "@/lib/email-layout";
import { GUARD_WINDOW_DAYS, guardVerdict, pausedEmail, type GuardCounts, type GuardReason, type GuardVerdict } from "@/lib/sending-guard";
import { siteUrl } from "@/lib/site";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";

import { audit, type Account } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";
import { owned } from "./owned";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The sending guard (D730, step M1.6 of `docs/audits/email-marketing-2026-11.md`): the only writer of `commerce.sending_pauses`. When a
 * marketing email bounces or is marked as spam (`applyEmailEvent()`), the store's marketing emails since the later of seven days ago and
 * its last resume are counted; past the line (`guardVerdict()`) its broadcasts and email automations are held (`isPaused()`, read by
 * `runBroadcasts()`, `startBroadcast()` and `runAutomations()`) and its owners are told by email. Order emails are never held. An owner
 * resumes from the Marketing pages; the counting then starts again from that moment.
 */

/** The email kinds the guard counts and holds: what the store chose to send to its list, not what a shopper's order sends. */
export const MARKETING_KINDS = ["marketing.broadcast", "marketing.automation"] as const;

export type SendingPause = { reason: GuardReason; counts: GuardCounts; pausedAt: string };
export type SendingHealth = { counts: GuardCounts; since: string; verdict: GuardVerdict; pause: SendingPause | null };

const kinds = sql.join(
  MARKETING_KINDS.map((k) => sql`${k}`),
  sql`, `,
);

const pauseRow = z.object({ reason: z.enum(["bounces", "complaints"]), counts: z.unknown(), paused_at: col.timestamp, resumed_at: col.timestampOrNull });
const countsOf = (v: unknown): GuardCounts => {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { sent: n(c.sent), bounced: n(c.bounced), complained: n(c.complained) };
};

async function pauseOf(storeId: string | null) {
  return typedRow(pauseRow, sql`select reason, counts, paused_at, resumed_at from commerce.sending_pauses where ${owned(storeId)}`);
}

/** Whether a store's marketing email is held. Never throws: a failed read holds nothing (the guard is a safety net, not a gate). */
export async function isPaused(storeId: string | null): Promise<boolean> {
  try {
    const p = await pauseOf(storeId);
    return Boolean(p && p.resumed_at === null);
  } catch (error) {
    log("warn", "sending_guard.read_failed", { storeId }, error);
    return false;
  }
}

/** What the guard counts for a store now, from when, what it says, and the pause if one holds. */
export async function sendingHealth(storeId: string | null, now = new Date()): Promise<SendingHealth> {
  const p = await pauseOf(storeId);
  const windowStart = new Date(now.getTime() - GUARD_WINDOW_DAYS * 86_400_000);
  const since = p?.resumed_at && new Date(p.resumed_at) > windowStart ? new Date(p.resumed_at) : windowStart;
  const counted = await typedRow(
    z.object({ sent: col.int, bounced: col.int, complained: col.int }),
    sql`
      select count(*)::int as sent,
        count(*) filter (where status = 'bounced')::int as bounced,
        count(*) filter (where status = 'complained')::int as complained
      from commerce.email_messages
      where ${owned(storeId)} and created_at >= ${since.toISOString()}::timestamptz and kind in (${kinds})
        and status in ('sent', 'delivered', 'bounced', 'complained')
    `,
  );
  const counts = counted ?? { sent: 0, bounced: 0, complained: 0 };
  return {
    counts,
    since: since.toISOString(),
    verdict: guardVerdict(counts),
    pause: p && p.resumed_at === null ? { reason: p.reason, counts: countsOf(p.counts), pausedAt: p.paused_at } : null,
  };
}

/**
 * Looks at one store after a bounce or a spam report on its marketing email, and pauses it when the line is passed. A store already paused
 * is left as it is. Never throws.
 */
export async function guardStore(storeId: string | null, now = new Date()): Promise<"paused" | "held" | "ok"> {
  try {
    const health = await sendingHealth(storeId, now);
    if (health.pause) return "held";
    if (health.verdict.level !== "pause") return "ok";
    const reason = health.verdict.reason;
    const [written] = await db().execute(sql`
      insert into commerce.sending_pauses (store_id, reason, counts, paused_at)
      values (${storeId}::uuid, ${reason}, ${JSON.stringify(health.counts)}::jsonb, ${now.toISOString()}::timestamptz)
      on conflict (store_id) do update set reason = excluded.reason, counts = excluded.counts, paused_at = excluded.paused_at,
        resumed_at = null, resumed_by = null
        where commerce.sending_pauses.resumed_at is not null
      returning id
    `);
    if (!written) return "held";
    // An event for workflows, endpoints and the log (email plan M1.2, D732); Kaizena Flow's own pause (no store) has none.
    if (storeId) await db().execute(sql`select commerce.queue_integration_event(${storeId}::uuid, 'marketing.paused', ${String(written.id)}::uuid)`);
    await audit(null, storeId, "marketing.sending_paused", { reason, ...health.counts });
    await tellOwners(storeId, reason, health.counts, new Date(health.since));
    return "paused";
  } catch (error) {
    log("error", "sending_guard.check_failed", { storeId }, error);
    return "ok";
  }
}

/** The owner resumes the store's marketing email; the guard counts afresh from now. */
export async function resumeSending(actor: Account, storeId: string | null): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.sending_pauses set resumed_at = now(), resumed_by = ${actor.id}::uuid
    where ${owned(storeId)} and resumed_at is null
    returning id
  `);
  if (rows.length === 0) return false;
  await audit(actor.id, storeId, "marketing.sending_resumed", {});
  return true;
}

/** The stores whose marketing email is held now, for Platform, Emails. */
export async function pausedStores(): Promise<{ storeId: string | null; name: string; slug: string | null; reason: GuardReason; pausedAt: string }[]> {
  const rows = await typedRows(
    z.object({ store_id: col.textOrNull, name: col.textOrNull, slug: col.textOrNull, reason: z.enum(["bounces", "complaints"]), paused_at: col.timestamp }),
    sql`
      select p.store_id, s.name, s.slug, p.reason, p.paused_at
      from commerce.sending_pauses p left join commerce.stores s on s.id = p.store_id
      where p.resumed_at is null
      order by p.paused_at desc
      limit 100
    `,
  );
  return rows.map((r) => ({ storeId: r.store_id, name: r.name ?? "Kaizena Flow", slug: r.slug, reason: r.reason, pausedAt: r.paused_at }));
}

/** One email to each of the store's owners, in their admin language. Never throws: the Marketing pages say it anyway. */
async function tellOwners(storeId: string | null, reason: GuardReason, counts: GuardCounts, since: Date): Promise<void> {
  if (!storeId) return;
  try {
    const store = await typedRow(z.object({ name: col.text, slug: col.text, time_zone: col.text }), sql`select name, slug, time_zone from commerce.stores where id = ${storeId}::uuid`);
    if (!store) return;
    const owners = await typedRows(
      z.object({ id: col.uuid, email: col.text, admin_locale: col.textOrNull }),
      sql`
        select distinct on (a.id) a.id, a.email, a.admin_locale
        from commerce.store_members m join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
        where m.store_id = ${storeId}::uuid and m.disabled_at is null and m.role = 'owner' and a.email <> ''
      `,
    );
    const at = new Date().toISOString().slice(0, 13);
    for (const owner of owners) {
      const lang = adminLangOf(owner.admin_locale);
      await sendEmail({
        storeId,
        kind: "marketing.paused",
        to: owner.email,
        email: renderEmail(pausedEmail({ storeName: store.name, timeZone: store.time_zone, reason, counts, since, url: `${siteUrl()}/admin/${store.slug}/marketing` }, STAFF_EMAILS_WORDS[lang], lang)),
        fromName: "Kaizena Flow",
        idempotencyKey: `marketing.paused:${storeId}:${owner.id}:${at}`,
      });
    }
  } catch (error) {
    log("error", "sending_guard.tell_failed", { storeId }, error);
  }
}
