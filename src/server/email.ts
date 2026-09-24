import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { RenderedEmail } from "@/lib/email-layout";
import { emailSettings, type EmailSettings } from "@/lib/email-settings";

type Row = Record<string, unknown>;

/**
 * Sending email (decisions D26, D32). Kaizen sends through Resend, from a
 * domain verified there in the EU region, with the store's name as the
 * sender and its contact address for replies. Every email is kept in
 * `email_messages` first; without Resend settings it is only kept there
 * (status `logged`), so nothing breaks before setup. Resend reports
 * deliveries, bounces and complaints back to /api/resend/webhook.
 *
 * Settings (Vercel environment): RESEND_API_KEY (a sending key, `re_…`),
 * EMAIL_FROM, an address on the verified domain (e.g.
 * butikk@kaizenstore.cloud), and RESEND_WEBHOOK_SECRET (`whsec_…`) for the
 * delivery events.
 */

export { emailSettings, emailSetup, type EmailSettings } from "@/lib/email-settings";

const RESEND = "https://api.resend.com/emails";
const TRIES = 3;

type Delivery = { ok: true; id: string } | { ok: false; error: string };

/**
 * One email to Resend. The kept email's id is the idempotency key, so a
 * retry (here, or a later resend of the same row) never sends it twice.
 * Busy (429) and server errors are tried again, briefly.
 */
export async function deliver(
  settings: EmailSettings,
  id: string,
  message: Pick<OutgoingEmail, "storeId" | "kind" | "to" | "email" | "fromName" | "replyTo">,
  fetcher: typeof fetch = fetch,
): Promise<Delivery> {
  const body = JSON.stringify({
    from: `"${senderName(message.fromName)}" <${settings.from}>`,
    to: [message.to],
    subject: message.email.subject,
    html: message.email.html,
    text: message.email.text,
    ...(message.replyTo && { reply_to: [message.replyTo] }),
    tags: [
      { name: "kind", value: message.kind.replace(/[^A-Za-z0-9_-]/g, "_") },
      { name: "store", value: message.storeId ?? "kaizen" },
    ],
  });
  let error = "unknown";
  for (let attempt = 0; attempt < TRIES; attempt++) {
    let wait = 250 * 2 ** attempt;
    try {
      const response = await fetcher(RESEND, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `email-${id}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (response.ok && result.id) return { ok: true, id: result.id };
      error = `${response.status} ${result.name ?? ""}: ${result.message ?? response.statusText}`.slice(0, 500);
      if (response.status !== 429 && response.status < 500) break;
      const after = Number(response.headers.get("retry-after"));
      if (after > 0) wait = Math.min(after * 1000, 2000);
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message.slice(0, 500) : "network error";
    }
    if (attempt < TRIES - 1) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return { ok: false, error };
}

/** A display name safe in an email header: no quotes, line breaks or angle brackets. */
export function senderName(name: string): string {
  return name.replace(/["\r\n<>\\]/g, "").trim().slice(0, 60) || "Kaizen";
}

export type OutgoingEmail = {
  storeId: string | null;
  kind: string;
  to: string;
  email: RenderedEmail;
  /** The store's name, shown as the sender. */
  fromName: string;
  replyTo?: string | null;
  /** The same key never sends twice (e.g. `order-confirmation:{orderId}`). */
  idempotencyKey?: string;
  orderId?: string | null;
  subscriptionId?: string | null;
};

export type SendOutcome = "sent" | "logged" | "failed" | "duplicate";

/** Keeps the email, then sends it if email is set up. Never throws. */
export async function sendEmail(message: OutgoingEmail): Promise<SendOutcome> {
  let id: string;
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.email_messages (
        store_id, kind, idempotency_key, to_address, subject, html, text, order_id, subscription_id
      ) values (
        ${message.storeId}::uuid, ${message.kind}, ${message.idempotencyKey ?? null}, ${message.to},
        ${message.email.subject}, ${message.email.html}, ${message.email.text},
        ${message.orderId ?? null}::uuid, ${message.subscriptionId ?? null}::uuid
      )
      on conflict (idempotency_key) do nothing
      returning id
    `);
    if (!row) return "duplicate";
    id = String(row.id);
  } catch {
    return "failed";
  }

  const settings = emailSettings();
  if (!settings) {
    await db().execute(sql`update commerce.email_messages set status = 'logged' where id = ${id}::uuid`);
    return "logged";
  }
  const delivery = await deliver(settings, id, message);
  if (delivery.ok) {
    await db().execute(sql`
      update commerce.email_messages set status = 'sent', provider_reference = ${delivery.id}, sent_at = now(), error = null
      where id = ${id}::uuid
    `);
    return "sent";
  }
  await db().execute(sql`
    update commerce.email_messages set status = 'failed', error = ${delivery.error} where id = ${id}::uuid
  `);
  return "failed";
}

export type EmailLogRow = {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: "queued" | "sent" | "failed" | "logged" | "delivered" | "bounced" | "complained";
  error: string | null;
  createdAt: string;
  storeName: string | null;
};

/** The latest emails, for staff: a store's, or every store's for platform admins. */
export async function listEmails({
  storeId,
  orderId,
  subscriptionId,
  limit = 100,
}: {
  storeId?: string | null;
  orderId?: string;
  subscriptionId?: string;
  limit?: number;
}): Promise<EmailLogRow[]> {
  const rows = await db().execute<Row>(sql`
    select e.id, e.kind, e.to_address, e.subject, e.status, e.error, e.created_at, s.name as store_name
    from commerce.email_messages e
    left join commerce.stores s on s.id = e.store_id
    where true
      ${storeId ? sql`and e.store_id = ${storeId}::uuid` : sql``}
      ${orderId ? sql`and e.order_id = ${orderId}::uuid` : sql``}
      ${subscriptionId ? sql`and e.subscription_id = ${subscriptionId}::uuid` : sql``}
    order by e.created_at desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    to: String(row.to_address),
    subject: String(row.subject),
    status: row.status as EmailLogRow["status"],
    error: row.error ? String(row.error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    storeName: row.store_name ? String(row.store_name) : null,
  }));
}

/** One email as sent, for staff to read; limited to a store unless platform-wide. */
export async function getEmail(id: string, storeId: string | null): Promise<(EmailLogRow & { html: string }) | null> {
  const [row] = await db().execute<Row>(sql`
    select e.id, e.kind, e.to_address, e.subject, e.status, e.error, e.created_at, e.html, s.name as store_name
    from commerce.email_messages e left join commerce.stores s on s.id = e.store_id
    where e.id = ${id}::uuid ${storeId ? sql`and e.store_id = ${storeId}::uuid` : sql``}
  `);
  return row
    ? {
        id: String(row.id),
        kind: String(row.kind),
        to: String(row.to_address),
        subject: String(row.subject),
        status: row.status as EmailLogRow["status"],
        error: row.error ? String(row.error) : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
        storeName: row.store_name ? String(row.store_name) : null,
        html: String(row.html),
      }
    : null;
}
