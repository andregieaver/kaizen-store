import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { PeakInput } from "@/lib/capacity-events";
import { renderEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";

import { audit } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";

/**
 * Busy times owners tell Kaizena Flow about (D314, `docs/capacity.md` step 4.1): written only here; the platform's admins are emailed 7
 * days and 1 day before a very busy one, once each, so there is time to make room (the capacity runbook). Kept 12 months.
 */

type Row = Record<string, unknown>;

export type Peak = { id: string; startsAt: string; endsAt: string; expected: "busy" | "very_busy"; note: string };

const toPeak = (r: Row): Peak => ({
  id: String(r.id),
  startsAt: new Date(String(r.starts_at)).toISOString(),
  endsAt: new Date(String(r.ends_at)).toISOString(),
  expected: r.expected === "very_busy" ? "very_busy" : "busy",
  note: String(r.note ?? ""),
});

/** A store's busy times that have not ended. */
export async function storePeaks(storeId: string, now: Date = new Date()): Promise<Peak[]> {
  const rows = await db().execute<Row>(sql`
    select id, starts_at, ends_at, expected, note from commerce.capacity_events
    where store_id = ${storeId}::uuid and ends_at > ${now.toISOString()}::timestamptz order by starts_at
  `);
  return rows.map(toPeak);
}

export async function addPeak(accountId: string, storeId: string, peak: PeakInput): Promise<void> {
  await db().execute(sql`
    insert into commerce.capacity_events (store_id, starts_at, ends_at, expected, note, created_by)
    values (${storeId}::uuid, ${peak.startsAt.toISOString()}::timestamptz, ${peak.endsAt.toISOString()}::timestamptz, ${peak.expected}, ${peak.note}, ${accountId}::uuid)
  `);
  await audit(accountId, storeId, "billing.capacity_event_added", { starts: peak.startsAt.toISOString(), ends: peak.endsAt.toISOString(), expected: peak.expected });
}

export async function removePeak(accountId: string, storeId: string, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`delete from commerce.capacity_events where store_id = ${storeId}::uuid and id = ${id}::uuid returning id`);
  if (rows.length > 0) await audit(accountId, storeId, "billing.capacity_event_removed", {});
  return rows.length > 0;
}

/** Every store's busy times coming up or running, for the platform's page. */
export async function upcomingPeaks(now: Date = new Date()): Promise<(Peak & { slug: string; name: string })[]> {
  const rows = await db().execute<Row>(sql`
    select e.id, e.starts_at, e.ends_at, e.expected, e.note, s.slug, s.name from commerce.capacity_events e
    join commerce.stores s on s.id = e.store_id
    where e.ends_at > ${now.toISOString()}::timestamptz order by e.starts_at limit 50
  `);
  return rows.map((r) => ({ ...toPeak(r), slug: String(r.slug), name: String(r.name) }));
}

/** Busy times older than 12 months go. Never throws. */
export async function prunePeaks(): Promise<number> {
  try {
    const rows = await db().execute(sql`with d as (delete from commerce.capacity_events where ends_at < now() - interval '12 months' returning 1) select count(*)::int as n from d`);
    return Number(rows[0]?.n ?? 0);
  } catch (error) {
    log("error", "capacity.prune_failed", {}, error);
    return 0;
  }
}

/** Emails the platform's admins 7 days and 1 day before a very busy time, once each by the email's key. Never throws. */
export async function sendPeakNotices(now: Date = new Date()): Promise<number> {
  let sent = 0;
  try {
    const peaks = await db().execute<Row>(sql`
      select e.id, e.starts_at, e.ends_at, e.note, s.name, s.slug,
             case when e.starts_at <= ${now.toISOString()}::timestamptz + interval '1 day' then 1 else 7 end as days
      from commerce.capacity_events e join commerce.stores s on s.id = e.store_id
      where e.expected = 'very_busy' and e.starts_at > ${now.toISOString()}::timestamptz and e.starts_at <= ${now.toISOString()}::timestamptz + interval '7 days'
    `);
    if (peaks.length === 0) return 0;
    const admins = await db().execute<Row>(sql`select id, email from commerce.accounts where platform_admin and disabled_at is null and email <> ''`);
    for (const peak of peaks) {
      const starts = new Date(String(peak.starts_at)).toISOString().slice(0, 10);
      const ends = new Date(String(peak.ends_at)).toISOString().slice(0, 10);
      const subject = `${String(peak.name)} expects to be very busy from ${starts}`;
      const email = renderEmail({
        subject,
        preview: `${starts} to ${ends}. Make room before it starts.`,
        lang: "en",
        footer: ["Kaizena Flow · kaizenaflow.com"],
        blocks: [
          { type: "heading", text: subject },
          { type: "paragraph", text: `${String(peak.name)} told Kaizena Flow it expects to be very busy from ${starts} to ${ends}.${peak.note ? ` Their note: ${String(peak.note)}` : ""}` },
          { type: "paragraph", text: "Follow the capacity runbook (docs/capacity.md, section Capacity runbook): check the database's compute size and connections, and raise them before it starts if they are close." },
          { type: "button", text: "Open usage and limits", url: `${siteUrl()}/admin/platform/capacity` },
        ],
      });
      for (const admin of admins) {
        const outcome = await sendEmail({ storeId: null, kind: "capacity.upcoming", to: String(admin.email), email, fromName: "Kaizena Flow", idempotencyKey: `capacity:${String(peak.id)}:${String(peak.days)}:${String(admin.id)}` });
        if (outcome === "sent" || outcome === "logged") sent++;
      }
    }
  } catch (error) {
    log("error", "capacity.notices_failed", {}, error);
  }
  return sent;
}
