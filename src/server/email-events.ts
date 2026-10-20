import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { unsubscribeAddress } from "./marketing-subscribers";

/**
 * What happens to an email after Resend accepts it (D32): delivered,
 * bounced or marked as spam. Resend signs each event (Svix); the status
 * is shown to staff in the email log. Resend itself stops sending to an
 * address that bounced or complained, and the store's list does too (D297): a
 * hard bounce or a complaint about any email a store sent unsubscribes that
 * address from the store's marketing email.
 */

/** Events older or newer than this are refused, so a captured one cannot be replayed later. */
const TOLERANCE_SECONDS = 5 * 60;

/** Checks a Svix signature: HMAC-SHA256 of `id.timestamp.body` with the secret after `whsec_`. */
export function verifyEmailEvent(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret.startsWith("whsec_")) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  // Several signatures may be sent while a secret is being rotated: "v1,abc v1,def".
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

type Row = Record<string, unknown>;

/** The address of a store's email leaves that store's marketing list (3.3). Kaizena Flow's own emails and erased addresses have none. */
async function leaveList(rows: Row[], source: "bounce" | "complaint") {
  for (const row of rows) {
    if (!row.store_id || !row.to_address || row.to_address === "[removed]") continue;
    await unsubscribeAddress(String(row.store_id), String(row.to_address), source);
  }
}

type EmailEvent = {
  type?: string;
  data?: { email_id?: string; bounce?: { message?: string; type?: string }; failed?: { reason?: string } };
};

/** Records an event on the email it is about. False when it names no email Kaizen sent. */
export async function applyEmailEvent(event: EmailEvent): Promise<boolean> {
  const reference = event.data?.email_id;
  if (!reference) return false;
  let rows: unknown[] = [];
  switch (event.type) {
    case "email.delivered":
      // A delivery never hides a later bounce or complaint.
      rows = await db().execute(sql`
        update commerce.email_messages set status = 'delivered'
        where provider_reference = ${reference} and status in ('queued', 'sent')
        returning id
      `);
      break;
    case "email.bounced": {
      const bounce = event.data?.bounce;
      const error = [bounce?.type, bounce?.message].filter(Boolean).join(": ").slice(0, 500) || "Bounced";
      rows = await db().execute<Row>(sql`
        update commerce.email_messages set status = 'bounced', error = ${error}
        where provider_reference = ${reference} and status <> 'complained'
        returning id, store_id, to_address
      `);
      // Only a hard bounce: a full mailbox or a busy server is tried again another day.
      if (bounce?.type === "Permanent") await leaveList(rows as Row[], "bounce");
      break;
    }
    case "email.complained":
      rows = await db().execute<Row>(sql`
        update commerce.email_messages set status = 'complained'
        where provider_reference = ${reference}
        returning id, store_id, to_address
      `);
      await leaveList(rows as Row[], "complaint");
      break;
    case "email.failed":
      rows = await db().execute(sql`
        update commerce.email_messages set status = 'failed', error = ${(event.data?.failed?.reason ?? "Failed").slice(0, 500)}
        where provider_reference = ${reference} and status in ('queued', 'sent')
        returning id
      `);
      break;
    default:
      // Sent, delayed, opened, clicked: nothing to record.
      return true;
  }
  return rows.length > 0;
}
