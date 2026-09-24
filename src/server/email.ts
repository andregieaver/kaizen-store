import "server-only";

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { RenderedEmail } from "@/lib/email-layout";

type Row = Record<string, unknown>;

/**
 * Sending email (decision D26). Kaizen sends through Amazon SES in the EU,
 * with the store's name as the sender and its contact address for replies.
 * Every email is kept in `email_messages` first; without SES settings it is
 * only kept there (status `logged`), so nothing breaks before setup.
 *
 * Settings (Vercel environment): SES_REGION (e.g. eu-north-1),
 * SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, and EMAIL_FROM, an address on a
 * domain verified in SES (e.g. butikk@kaizenstore.cloud).
 */

export type EmailSettings = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  from: string;
};

export function emailSettings(env: Record<string, string | undefined> = process.env): EmailSettings | null {
  const region = env.SES_REGION?.trim();
  const accessKeyId = env.SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.SES_SECRET_ACCESS_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!region || !accessKeyId || !secretAccessKey || !from || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) {
    return null;
  }
  return { region, accessKeyId, secretAccessKey, from };
}

let client: { key: string; ses: SESv2Client } | null = null;

function ses(settings: EmailSettings): SESv2Client {
  const key = `${settings.region}:${settings.accessKeyId}`;
  if (client?.key !== key) {
    client = {
      key,
      ses: new SESv2Client({
        region: settings.region,
        credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      }),
    };
  }
  return client.ses;
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
  try {
    const result = await ses(settings).send(
      new SendEmailCommand({
        FromEmailAddress: `"${senderName(message.fromName)}" <${settings.from}>`,
        Destination: { ToAddresses: [message.to] },
        ...(message.replyTo && { ReplyToAddresses: [message.replyTo] }),
        Content: {
          Simple: {
            Subject: { Data: message.email.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: message.email.html, Charset: "UTF-8" },
              Text: { Data: message.email.text, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
    await db().execute(sql`
      update commerce.email_messages set status = 'sent', provider_reference = ${result.MessageId ?? null}, sent_at = now()
      where id = ${id}::uuid
    `);
    return "sent";
  } catch (error) {
    await db().execute(sql`
      update commerce.email_messages set status = 'failed', error = ${error instanceof Error ? error.message.slice(0, 500) : "unknown"}
      where id = ${id}::uuid
    `);
    return "failed";
  }
}

export type EmailLogRow = {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: "queued" | "sent" | "failed" | "logged";
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
