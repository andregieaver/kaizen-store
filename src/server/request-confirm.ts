import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { marketUrl } from "@/lib/paths";
import { REQUEST_CONFIRM_HOURS, requestConfirmText } from "@/lib/request-confirm-text";
import { requestAddress, type RequestAddress } from "@/lib/support-actions";

import { sendEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { emailContext, emailFooter } from "./shopper-emails";
import { col, typedRow } from "./typed-rows";

/**
 * A customer's request by email, confirmed from the order's own address (`docs/100-day-challenge.md` B3, D685). An address change or a
 * cancellation asked in an email conversation (`request_staff_action`) cannot be carried out by code on the email alone: an email that did not
 * fail DMARC may still come from a domain with no DMARC policy, so its From can be anyone's. When the conversation's address is the order's own,
 * the order still paid, not held and nothing of it sent, and the store's autopilot reacts, the order's address gets one email with a one-time
 * link (`REQUEST_CONFIRM_HOURS`, its token kept only as a sha-256 hash). The link opens a page that says what will be done; pressing Confirm
 * (a POST, so a mail scanner that opens links confirms nothing) sets `customer_confirmed_at`. The request then counts as a signed-in chat's:
 * the `staff_request` event and `carry_out_address_change` accept it (`src/server/support-requests.ts`). Nothing is done on the page itself.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const CANDIDATE = z.object({
  id: col.uuid,
  store_id: col.uuid,
  kind: col.text,
  summary: col.text,
  args: z.unknown(),
  locale: col.text,
  market: col.textOrNull,
  order_number: col.text,
  order_email: col.text,
  market_code: col.text,
});

/** The request's new address, when it is an address change that has one. */
function addressOf(args: unknown): RequestAddress | null {
  const raw = args && typeof args === "object" ? (args as Record<string, unknown>).address : undefined;
  const parsed = raw ? requestAddress.safeParse(raw) : null;
  return parsed?.success ? parsed.data : null;
}

/**
 * Emails the link to confirm a request just made in an email conversation, when code could carry it out once confirmed. Returns whether it
 * went (`sent`), or null when the request is not one to confirm. Never throws: a failure leaves the request to a person, as before.
 */
export async function offerRequestConfirmation(actionId: string): Promise<SendOutcome | null> {
  try {
    const row = await typedRow(
      CANDIDATE,
      sql`
        select a.id, a.store_id, a.kind, a.summary, a.args, c.locale, c.market, o.number as order_number, o.email as order_email, o.market_code
        from commerce.support_actions a
        join commerce.support_conversations c on c.id = a.conversation_id and c.store_id = a.store_id
        join commerce.orders o on o.store_id = a.store_id and o.number = a.args ->> 'orderNumber' and o.copied_from is null
          and o.restricted_at is null and o.anonymised_at is null
        join commerce.autopilot_settings ap on ap.store_id = a.store_id and not ap.paused and coalesce((ap.planning ->> 'reacts')::boolean, false)
        where a.id = ${actionId}::uuid and a.confirmer = 'staff' and a.status = 'proposed' and a.confirm_sent_at is null
          and a.kind in ('change_address', 'cancel_order') and (a.kind <> 'change_address' or a.args ? 'address')
          and c.source = 'email' and c.anonymised_at is null and c.contact_email is not null and lower(c.contact_email) = lower(o.email)
          and o.status in ('paid', 'authorized') and o.held_at is null
          and not exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null)
          and commerce.store_is_active(a.store_id)
      `,
    );
    if (!row) return null;
    const ctx = await emailContext(row.store_id, (row.market ?? row.market_code).slice(0, 2).toUpperCase(), row.locale);
    if (!ctx) return null;
    const token = randomBytes(32).toString("hex");
    const kept = await db().execute(sql`
      update commerce.support_actions set confirm_token_hash = ${hash(token)}, confirm_sent_at = now()
      where id = ${actionId}::uuid and store_id = ${row.store_id}::uuid and confirm_sent_at is null
      returning id
    `);
    if (kept.length === 0) return null;
    const lang = row.locale.split("-")[0] || "en";
    const w = requestConfirmText(lang);
    const address = row.kind === "change_address" ? addressOf(row.args) : null;
    const lines = address ? [address.name, address.line1, address.line2, `${address.postalCode} ${address.city}`].filter((l): l is string => Boolean(l)) : [];
    const blocks: EmailBlock[] = [
      { type: "heading", text: w.heading },
      { type: "paragraph", text: w.intro(row.order_number) },
      // Code's own words for the request, never the AI's or the customer's.
      { type: "paragraph", text: row.summary },
      ...(lines.length > 0 ? [{ type: "paragraph" as const, text: `${w.newAddress} ${lines.join(", ")}` }] : []),
      { type: "button", text: w.button, url: marketUrl(ctx.store.slug, ctx.market.slug, `/request/${token}`) },
      { type: "paragraph", text: w.linkNote(REQUEST_CONFIRM_HOURS) },
      { type: "paragraph", text: w.why(ctx.store.name) },
    ];
    const subject = w.subject(ctx.store.name, row.order_number);
    const email = renderEmail({ subject, preview: subject, blocks, footer: emailFooter(ctx.store, ctx.text), lang });
    return await sendEmail({
      storeId: row.store_id,
      kind: "support.request_confirm",
      to: row.order_email,
      email,
      fromName: ctx.store.name,
      replyTo: ctx.store.details.contactEmail,
      idempotencyKey: `support.request_confirm:${actionId}`,
    });
  } catch (error) {
    log("error", "support.request_confirm_failed", { actionId }, error);
    return null;
  }
}

const OPEN = z.object({ id: col.uuid, summary: col.text, order_number: col.text, open: col.bool, confirmed: col.bool });

export type RequestToConfirm = { summary: string; orderNumber: string; state: "open" | "confirmed" | "closed" };

/** The request a link is for, among the store's, for its page; null for a token that is no request's. */
export async function requestToConfirm(storeId: string, token: string): Promise<RequestToConfirm | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await typedRow(
    OPEN,
    sql`
      select a.id, a.summary, a.args ->> 'orderNumber' as order_number,
        (a.status = 'proposed' and a.customer_confirmed_at is null and a.confirm_sent_at > now() - make_interval(hours => ${REQUEST_CONFIRM_HOURS})) as open,
        (a.customer_confirmed_at is not null) as confirmed
      from commerce.support_actions a
      where a.store_id = ${storeId}::uuid and a.confirm_token_hash = ${hash(token)}
    `,
  );
  if (!row) return null;
  return { summary: row.summary, orderNumber: row.order_number, state: row.confirmed ? "confirmed" : row.open ? "open" : "closed" };
}

/**
 * The customer's Confirm on the link's page: only an open request of this store, within the link's hours, once. Returns whether it is
 * confirmed now (true also when it was already).
 */
export async function confirmRequestByLink(storeId: string, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const rows = await db().execute(sql`
    update commerce.support_actions set customer_confirmed_at = now()
    where store_id = ${storeId}::uuid and confirm_token_hash = ${hash(token)} and status = 'proposed' and customer_confirmed_at is null
      and confirm_sent_at > now() - make_interval(hours => ${REQUEST_CONFIRM_HOURS})
    returning conversation_id
  `);
  if (rows.length > 0) {
    log("info", "support.request_confirmed", { storeId });
    return true;
  }
  return (await requestToConfirm(storeId, token))?.state === "confirmed";
}
