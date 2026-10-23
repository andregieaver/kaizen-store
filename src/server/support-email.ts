import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { renderEmail, type EmailBlock, type RenderedEmail } from "@/lib/email-layout";
import { marketUrl } from "@/lib/paths";
import { can } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";
import { supportEmailText } from "@/lib/support-email-text";
import { EMAIL_EVERY_MINUTES, EMAILS_MAX, ONLINE_SECONDS } from "@/lib/support-rules";

import type { Role } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import { emailContext, emailFooter } from "./shopper-emails";
import { newEmailToken } from "./support";
import { systemDesk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * Support's emails (D216, `docs/support.md` 2.3 and 2.9, step 5), run every minute by `/api/cron/integrations`:
 *
 * - `support.reply` to a customer: when a person answered while the customer had not looked for `REPLY_AFTER_SECONDS`, one email
 *   carries the people's messages since the last email (at most one every `EMAIL_EVERY_MINUTES`, `EMAILS_MAX` a conversation) and a
 *   new link back to the conversation (the newest email's link alone opens it). It goes to a signed-in customer's own address, else
 *   to the email they left; only on a desk with support on and email follow-up.
 * - `support.waiting` to the desk's people: a conversation has waited the desk's `notify_after_minutes` for a person; every person
 *   who may answer there and is not online gets one email, once for each time it entered the queue. It names no customer and holds
 *   none of their words.
 *
 * Never throws: a conversation that fails is logged and the next goes on.
 */

/** The customer had not looked at the conversation for this long when a person wrote. */
export const REPLY_AFTER_SECONDS = 60;

const TOLD: readonly SendOutcome[] = ["sent", "logged", "duplicate"];

export type SupportEmailRun = { replies: number; waiting: number; failed: number };

export async function sendSupportEmails(now: Date = new Date()): Promise<SupportEmailRun> {
  const out: SupportEmailRun = { replies: 0, waiting: 0, failed: 0 };
  for (const job of [sendReplyEmails, sendWaitingAlerts]) {
    try {
      const run = await job(now);
      out.replies += run.replies;
      out.waiting += run.waiting;
      out.failed += run.failed;
    } catch (error) {
      console.error("[support] the emails could not be read", error);
    }
  }
  return out;
}

/** The answer emails due now (see the module's note). */
export async function sendReplyEmails(now: Date = new Date(), limit = 100): Promise<SupportEmailRun> {
  const out: SupportEmailRun = { replies: 0, waiting: 0, failed: 0 };
  const at = sql`${now.toISOString()}::timestamptz`;
  const rows = await db().execute<Row>(sql`
    select c.id, c.store_id, c.locale, c.market, c.email_sent_seq, c.source, coalesce(cu.email, ra.email, c.contact_email) as address
    from commerce.support_conversations c
    join commerce.support_settings s on s.store_id is not distinct from c.store_id
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    -- An account asking Kaizena Flow from the admin (step 11) is answered at its own address.
    left join commerce.accounts ra on c.source = 'admin' and ra.id = c.requester_id
    where c.anonymised_at is null and s.mode <> 'off' and (s.email_followup or c.source = 'admin')
      and coalesce(cu.email, ra.email, c.contact_email) is not null and c.email_count < ${EMAILS_MAX}
      and (c.email_sent_at is null or c.email_sent_at <= ${at} - make_interval(mins => ${EMAIL_EVERY_MINUTES}))
      and (c.visitor_seen_at is null or c.visitor_seen_at <= ${at} - make_interval(secs => ${REPLY_AFTER_SECONDS}))
      and (c.store_id is null or commerce.store_is_active(c.store_id))
      and exists (
        select 1 from commerce.support_messages m
        where m.conversation_id = c.id and m.author = 'agent' and m.seq > c.email_sent_seq
          and m.created_at > coalesce(c.visitor_seen_at, '-infinity'::timestamptz)
          and m.created_at <= ${at} - make_interval(secs => ${REPLY_AFTER_SECONDS}))
    order by c.last_message_at limit ${limit}
  `);
  for (const row of rows) {
    try {
      const outcome = await sendReply(row);
      if (outcome === null) continue;
      if (TOLD.includes(outcome)) out.replies += 1;
      else out.failed += 1;
    } catch (error) {
      out.failed += 1;
      console.error(`[support] the answer email of ${String(row.id)} failed`, error);
    }
  }
  return out;
}

async function sendReply(row: Row): Promise<SendOutcome | null> {
  const id = String(row.id);
  const storeId = row.store_id ? String(row.store_id) : null;
  const desk = systemDesk(storeId);
  const messages = await db().execute<Row>(sql`
    select seq, body, data from commerce.support_messages
    where conversation_id = ${id}::uuid and author = 'agent' and seq > ${Number(row.email_sent_seq)}
    order by seq limit 20
  `);
  if (messages.length === 0) return null;
  const lastSeq = Math.max(...messages.map((m) => Number(m.seq)));
  const locale = String(row.locale);
  const words = supportEmailText(locale);
  const lines = messages.map((m) => {
    const name = (m.data as { name?: unknown } | null)?.name;
    return { type: "paragraph" as const, text: `${typeof name === "string" ? `${name}:\n` : ""}${String(m.body)}` };
  });

  let deskName: string;
  let url: string;
  let footer: string[];
  let replyTo: string | null = null;
  // An account's request from the admin is opened in the admin, by its session; no token is made.
  const admin = row.source === "admin";
  const token = admin ? "" : await newEmailToken(desk, id);
  if (admin) {
    deskName = "Kaizena Flow";
    url = `${siteUrl()}/admin/account/kaizen-support?c=${id}`;
    footer = ["Kaizena Flow"];
  } else if (storeId) {
    const market = row.market ? String(row.market) : "";
    const ctx = await emailContext(storeId, market.slice(0, 2).toUpperCase(), locale);
    if (!ctx) return null;
    deskName = ctx.store.name;
    url = `${marketUrl(ctx.store.slug, ctx.market.slug, `/account/support/${token}`)}`;
    footer = emailFooter(ctx.store, ctx.text);
    replyTo = ctx.store.details.contactEmail;
  } else {
    deskName = "Kaizena Flow";
    url = `${siteUrl()}/support/c/${token}`;
    footer = ["Kaizena Flow"];
  }
  const blocks: EmailBlock[] = [
    { type: "heading", text: words.heading },
    { type: "paragraph", text: words.intro(deskName) },
    // The people's own words, as text.
    ...lines,
    { type: "button", text: words.button, url },
    ...(admin
      ? [{ type: "paragraph" as const, text: "You get this email because you asked Kaizena Flow for help in the admin. The link opens the conversation after you sign in." }]
      : [
          { type: "paragraph" as const, text: words.linkNote },
          { type: "paragraph" as const, text: words.why },
        ]),
  ];
  const email = renderEmail({ subject: words.subject(deskName), preview: words.preview(deskName), blocks, footer, lang: locale.split("-")[0] || "en" });
  const outcome = await sendEmail({
    storeId,
    kind: "support.reply",
    to: String(row.address),
    email,
    fromName: deskName,
    replyTo,
    idempotencyKey: `support.reply:${id}:${lastSeq}`,
  });
  if (TOLD.includes(outcome)) {
    await db().execute(sql`
      update commerce.support_conversations set email_sent_seq = greatest(email_sent_seq, ${lastSeq}), email_count = least(email_count + 1, ${EMAILS_MAX}), email_sent_at = now()
      where id = ${id}::uuid
    `);
  }
  return outcome;
}

/** The waiting alerts due now (see the module's note). */
export async function sendWaitingAlerts(now: Date = new Date(), limit = 100): Promise<SupportEmailRun> {
  const out: SupportEmailRun = { replies: 0, waiting: 0, failed: 0 };
  const at = sql`${now.toISOString()}::timestamptz`;
  const rows = await db().execute<Row>(sql`
    select c.id, c.store_id, c.queued_at, st.slug, st.name,
      floor(extract(epoch from (${at} - c.queued_at)) / 60)::int as minutes
    from commerce.support_conversations c
    join commerce.support_settings s on s.store_id is not distinct from c.store_id
    left join commerce.stores st on st.id = c.store_id
    where c.status = 'open' and c.handler = 'queue' and c.anonymised_at is null and c.waiting_alert_at is null and s.mode <> 'off'
      and c.queued_at <= ${at} - make_interval(mins => s.notify_after_minutes)
      and (c.store_id is null or commerce.store_is_active(c.store_id))
    order by c.queued_at limit ${limit}
  `);
  for (const row of rows) {
    const id = String(row.id);
    try {
      const storeId = row.store_id ? String(row.store_id) : null;
      const people = await deskPeopleAway(storeId);
      const where = storeId ? String(row.name) : "Kaizena Flow";
      const inbox = storeId ? `${siteUrl()}/admin/${String(row.slug)}/support` : `${siteUrl()}/admin/platform/support`;
      const minutes = Math.max(1, Number(row.minutes));
      // Each person reads it in their own admin language (D312 A10); English exactly as before.
      const made = new Map<AdminLang, RenderedEmail>();
      const emailIn = (lang: AdminLang): RenderedEmail => {
        const hit = made.get(lang);
        if (hit) return hit;
        const w = adminText(lang, "staffEmails").supportWaiting;
        const email = renderEmail({
          subject: fillWords(w.subject, { where }),
          preview: fillWords(w.preview, { minutes }),
          lang: ADMIN_LANG_FACTS[lang].tag,
          footer: ["Kaizena Flow"],
          blocks: [
            { type: "heading", text: w.heading },
            { type: "paragraph", text: fillWords(w.text, { where, minutes }) },
            { type: "button", text: w.button, url: inbox },
            { type: "paragraph", text: w.why },
          ],
        });
        made.set(lang, email);
        return email;
      };
      const queuedAt = new Date(String(row.queued_at)).toISOString();
      for (const person of people) {
        const outcome = await sendEmail({ storeId, kind: "support.waiting", to: person.email, email: emailIn(person.lang), fromName: "Kaizena Flow", idempotencyKey: `support.waiting:${id}:${queuedAt}:${person.id}` });
        if (TOLD.includes(outcome)) out.waiting += 1;
        else out.failed += 1;
      }
      // Marked whatever was sent: one alert for each time it entered the queue (a new time in the queue clears the mark). A store's
      // integrations hear of it once too, in the same statement (event `support.waiting`, step 14: the count and the inbox, never who).
      await db().execute(sql`
        with marked as (
          update commerce.support_conversations set waiting_alert_at = now() where id = ${id}::uuid and waiting_alert_at is null returning id, store_id
        )
        select commerce.queue_integration_event(m.store_id, 'support.waiting', m.id) from marked m where m.store_id is not null
      `);
    } catch (error) {
      out.failed += 1;
      console.error(`[support] the waiting alert of ${id} failed`, error);
    }
  }
  return out;
}

/**
 * Who may answer a desk and is not online now: a store's members whose role holds `support:write` (active, not expired, with an
 * address), or Kaizen's platform admins.
 */
async function deskPeopleAway(storeId: string | null): Promise<{ id: string; email: string; lang: AdminLang }[]> {
  const online = sql`exists (select 1 from commerce.support_agents ag where ag.account_id = a.id and ag.store_id is not distinct from ${storeId}::uuid
    and ag.status = 'online' and ag.last_seen_at > now() - make_interval(secs => ${ONLINE_SECONDS}))`;
  if (!storeId) {
    const rows = await db().execute<Row>(sql`
      select a.id, a.email, a.admin_locale from commerce.accounts a where a.platform_admin and a.disabled_at is null and a.email <> '' and not ${online}
    `);
    return rows.map((r) => ({ id: String(r.id), email: String(r.email), lang: adminLangOf(r.admin_locale ? String(r.admin_locale) : null) }));
  }
  const rows = await db().execute<Row>(sql`
    select distinct on (a.id) a.id, a.email, a.admin_locale, m.role, m.kind, m.role_id, r.permissions as role_permissions
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id and a.disabled_at is null and a.email <> ''
    left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
    where m.store_id = ${storeId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now()) and not ${online}
  `);
  return rows
    .filter((r) =>
      can(
        {
          role: String(r.role) as Role,
          kind: r.kind === "collaborator" ? "collaborator" : "staff",
          permissions: r.role_id ? ((r.role_permissions ?? []) as unknown[]).map(String) : null,
        },
        "support:write",
      ),
    )
    .map((r) => ({ id: String(r.id), email: String(r.email), lang: adminLangOf(r.admin_locale ? String(r.admin_locale) : null) }));
}

/**
 * The customer is told by email that a person decided their request (step 10, `support.request_done`), when they are not looking at
 * the conversation: to a signed-in customer's own address, else to the email they left on a desk with email follow-up. It carries
 * the decision in the conversation's language, the person's note and a new link back. Never throws.
 */
export async function sendRequestDecisionEmail(conversationId: string, actionId: string): Promise<SendOutcome | null> {
  try {
    const [row] = await db().execute<Row>(sql`
      select c.id, c.store_id, c.locale, c.market, coalesce(cu.email, case when s.email_followup then c.contact_email end) as address,
        (c.visitor_seen_at is null or c.visitor_seen_at <= now() - make_interval(secs => ${REPLY_AFTER_SECONDS})) as away,
        a.status, a.summary, a.result ->> 'note' as note
      from commerce.support_conversations c
      join commerce.support_settings s on s.store_id is not distinct from c.store_id
      join commerce.support_actions a on a.conversation_id = c.id and a.id = ${actionId}::uuid
      left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
      where c.id = ${conversationId}::uuid and c.anonymised_at is null and s.mode <> 'off' and c.store_id is not null
        and commerce.store_is_active(c.store_id)
    `);
    if (!row || !row.address || !row.away || (row.status !== "done" && row.status !== "declined")) return null;
    const storeId = String(row.store_id);
    const locale = String(row.locale);
    const market = row.market ? String(row.market) : "";
    const ctx = await emailContext(storeId, market.slice(0, 2).toUpperCase(), locale);
    if (!ctx) return null;
    const words = supportEmailText(locale);
    const said = t(locale.split("-")[0] || "en").chat.actions;
    const token = await newEmailToken(systemDesk(storeId), conversationId);
    const url = `${marketUrl(ctx.store.slug, ctx.market.slug, `/account/support/${token}`)}`;
    const summary = String(row.summary);
    const blocks: EmailBlock[] = [
      { type: "heading", text: words.decisionHeading },
      { type: "paragraph", text: row.status === "done" ? said.decidedDone(summary) : said.decidedDeclined(summary) },
      // The person's own words, as text.
      ...(row.note ? [{ type: "paragraph" as const, text: said.note(String(row.note)) }] : []),
      { type: "button", text: words.button, url },
      { type: "paragraph", text: words.linkNote },
      { type: "paragraph", text: words.decisionWhy },
    ];
    const email = renderEmail({ subject: words.decisionSubject(ctx.store.name), preview: words.decisionSubject(ctx.store.name), blocks, footer: emailFooter(ctx.store, ctx.text), lang: locale.split("-")[0] || "en" });
    return await sendEmail({
      storeId,
      kind: "support.request_done",
      to: String(row.address),
      email,
      fromName: ctx.store.name,
      replyTo: ctx.store.details.contactEmail,
      idempotencyKey: `support.request_done:${actionId}`,
    });
  } catch (error) {
    console.error(`[support] the decision email of ${actionId} failed`, error);
    return null;
  }
}
