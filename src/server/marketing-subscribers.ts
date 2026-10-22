import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { writeCsv } from "@/lib/csv";
import { renderEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { t } from "@/lib/i18n";
import {
  CONFIRM_DAYS,
  PENDING_KEEP_DAYS,
  SUBSCRIBER_CSV_COLUMNS,
  SUBSCRIBER_STATUSES,
  TOKEN_PATTERN,
  type ConsentEventKind,
  type SubscribeSource,
  type SubscriberStatus,
  type UnsubscribeSource,
} from "@/lib/marketing-consent";
import { marketUrl } from "@/lib/paths";

import { audit } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import { emailFooter, storeById } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3): the only writer of `commerce.marketing_subscribers`. A person joins
 * from a page's newsletter form (its own confirmation link, D93), checkout or My account; a typed address is confirmed by its owner first, and only
 * a signed-in customer with a verified email subscribes at once. Leaving is one press and always works. Staff never subscribe anyone.
 */

const normal = (email: string) => email.trim().toLowerCase();
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export type JoinRequest = {
  storeId: string;
  email: string;
  name?: string;
  locale: string;
  marketCode: string | null;
  source: SubscribeSource;
  sourceRef?: string | null;
  /** The words the person agreed to, as shown. */
  consentText: string;
  consentedAt?: Date;
  /** The store's customer, only for a signed-in customer whose email is verified: the account is the proof. */
  customerId?: string | null;
  /**
   * How the consent is proven: `link` (a confirmation email is sent and the address waits), `confirmed` (the person opened a link already: a
   * form's own, D93), `account` (signed in with a verified email) or `unconfirmed` (a form whose owner switched confirmation off).
   */
  proof: "link" | "confirmed" | "account" | "unconfirmed";
};

/** What became of a request: subscribed at once, waiting for the link, or already subscribed (nothing changed). */
export type JoinOutcome = { status: "subscribed" | "pending" | "already"; subscriberId: string; email: SendOutcome | null };

/** Joins the list as the request's proof allows; the confirmation email goes in the same call when one is needed. */
export async function joinList(request: JoinRequest): Promise<JoinOutcome> {
  const email = normal(request.email);
  const consentedAt = (request.consentedAt ?? new Date()).toISOString();
  const pending = request.proof === "link";
  const confirmToken = pending ? newToken() : null;
  const confirmedAt = request.proof === "confirmed" ? new Date().toISOString() : null;
  const until = pending ? new Date(Date.now() + CONFIRM_DAYS * 86_400_000).toISOString() : null;
  const status: SubscriberStatus = pending ? "pending" : "subscribed";
  // A verified customer's account proves the address; a waiting request from an unverified one is theirs to see, and its link proves it.
  const customerId = request.proof === "account" || request.proof === "link" ? (request.customerId ?? null) : null;
  const name = (request.name ?? "").slice(0, 200);

  const result = await db().transaction(async (tx) => {
    const [existing] = await tx.execute<Row>(sql`
      select id, status, customer_id from commerce.marketing_subscribers
      where store_id = ${request.storeId}::uuid and lower(email) = ${email}
      for update
    `);
    if (existing?.status === "subscribed") {
      // A verified customer who subscribed by a form before: the account is now theirs too.
      if (request.proof === "account" && customerId && !existing.customer_id) {
        await tx.execute(sql`update commerce.marketing_subscribers set customer_id = ${customerId}::uuid where id = ${String(existing.id)}::uuid`);
      }
      return { status: "already" as const, subscriberId: String(existing.id) };
    }
    if (existing) {
      await tx.execute(sql`
        update commerce.marketing_subscribers set
          status = ${status}, source = ${request.source}, source_ref = ${request.sourceRef ?? null},
          consent_text = ${request.consentText}, consented_at = ${consentedAt}::timestamptz, confirmed_at = ${confirmedAt}::timestamptz,
          confirm_hash = ${confirmToken ? hash(confirmToken) : null}, confirm_until = ${until}::timestamptz,
          name = case when ${name} = '' then name else ${name} end, locale = ${request.locale}, market_code = ${request.marketCode},
          customer_id = coalesce(customer_id, ${customerId}::uuid)
        where id = ${String(existing.id)}::uuid
      `);
      return { status, subscriberId: String(existing.id) };
    }
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.marketing_subscribers (
        store_id, email, customer_id, name, locale, market_code, status, source, source_ref, consent_text, consented_at, confirmed_at,
        confirm_hash, confirm_until, token
      ) values (
        ${request.storeId}::uuid, ${email}, ${customerId}::uuid, ${name}, ${request.locale}, ${request.marketCode}, ${status}, ${request.source},
        ${request.sourceRef ?? null}, ${request.consentText}, ${consentedAt}::timestamptz, ${confirmedAt}::timestamptz,
        ${confirmToken ? hash(confirmToken) : null}, ${until}::timestamptz, ${newToken()}
      )
      returning id
    `);
    return { status, subscriberId: String(row.id) };
  });

  const sent = result.status === "pending" && confirmToken ? await sendConfirmation(request, email, confirmToken, result.subscriberId) : null;
  return { ...result, email: sent };
}

/** The link that confirms a sign-up from checkout or My account, to the address that asked, in its language. */
async function sendConfirmation(request: JoinRequest, to: string, token: string, subscriberId: string): Promise<SendOutcome> {
  const store = await storeById(request.storeId);
  if (!store) return "failed";
  const lang = request.locale.slice(0, 2);
  const m = t(lang);
  const market = store.markets.find((mk) => mk.code === request.marketCode) ?? store.markets[0];
  const link = `${marketUrl(store.slug, (market?.code ?? "").toLowerCase(), `/account/news/${token}`)}`;
  const email = renderEmail({
    subject: m.news.confirmSubject(store.name),
    preview: m.news.confirmHeading,
    blocks: [
      { type: "heading", text: m.news.confirmHeading },
      { type: "paragraph", text: m.news.confirmText(store.name) },
      { type: "button", text: m.news.confirmButton, url: link },
      { type: "paragraph", text: m.news.confirmValid },
    ],
    footer: emailFooter(store, emailText(lang)),
    lang,
  });
  return sendEmail({
    storeId: request.storeId,
    kind: "marketing.confirm",
    to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail ?? null,
    idempotencyKey: `marketing-confirm:${subscriberId}:${hash(token).slice(0, 16)}`,
  });
}

/** Whether a confirmation token is one this store's list is waiting on, still in time (the confirm page asks before it shows the button). */
export async function confirmationWaiting(storeId: string, token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.marketing_subscribers
    where store_id = ${storeId}::uuid and confirm_hash = ${hash(token)} and status = 'pending' and confirm_until > now()
  `);
  return Boolean(row);
}

/** The confirm page's button: the waiting address is subscribed, once, before its link runs out. False for a link unknown, used or too old. */
export async function confirmSubscription(storeId: string, token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const rows = await db().execute<Row>(sql`
    update commerce.marketing_subscribers set status = 'subscribed', confirmed_at = now()
    where store_id = ${storeId}::uuid and confirm_hash = ${hash(token)} and status = 'pending' and confirm_until > now()
    returning id
  `);
  return rows.length > 0;
}

/** Leaves the list from an email's link or a mail app's one-click button; the store it was for, or null for a token that is not a subscriber's. */
export async function unsubscribeByToken(token: string, source: "link" | "one_click"): Promise<{ storeId: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db().execute<Row>(sql`select id, store_id, status from commerce.marketing_subscribers where token = ${token}`);
  if (!row) return null;
  if (row.status !== "unsubscribed") await leave(String(row.store_id), String(row.id), source);
  return { storeId: String(row.store_id) };
}

/** Whether a token is a subscriber's of this store (the unsubscribe page then speaks of news and offers, not of cart reminders). */
export async function isSubscriberToken(storeId: string, token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const [row] = await db().execute<Row>(sql`select 1 from commerce.marketing_subscribers where store_id = ${storeId}::uuid and token = ${token}`);
  return Boolean(row);
}

async function leave(storeId: string, id: string, source: UnsubscribeSource): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = ${source}
    where store_id = ${storeId}::uuid and id = ${id}::uuid and status <> 'unsubscribed'
    returning id
  `);
  return rows.length > 0;
}

/** An address that bounced for good or was marked as spam stops getting marketing email (from the email provider's events). */
export async function unsubscribeAddress(storeId: string, email: string, source: "complaint" | "bounce"): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = ${source}
    where store_id = ${storeId}::uuid and lower(email) = ${normal(email)} and status <> 'unsubscribed'
    returning id
  `);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// My account and checkout
// ---------------------------------------------------------------------------

type AccountCustomer = { id: string; email: string; emailVerified: boolean; locale: string | null };

/** The store's own customer, read from the database: whether their email is proven is never taken from the browser. */
async function accountCustomer(storeId: string, customerId: string): Promise<AccountCustomer | null> {
  const [row] = await db().execute<Row>(sql`
    select id, email, email_verified_at is not null as verified, locale from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  return row ? { id: String(row.id), email: String(row.email), emailVerified: Boolean(row.verified), locale: row.locale ? String(row.locale) : null } : null;
}

/** The signed-in customer's own state: their account's subscriber, else the one with their verified address. */
export async function accountSubscription(storeId: string, customerId: string): Promise<SubscriberStatus | null> {
  const customer = await accountCustomer(storeId, customerId);
  if (!customer) return null;
  const [row] = await db().execute<Row>(sql`
    select status from commerce.marketing_subscribers
    where store_id = ${storeId}::uuid
      and (customer_id = ${customer.id}::uuid or (${customer.emailVerified} and lower(email) = ${normal(customer.email)}))
    order by (customer_id = ${customer.id}::uuid) desc nulls last
    limit 1
  `);
  return row ? (String(row.status) as SubscriberStatus) : null;
}

/**
 * My account's switch, and checkout's box for a signed-in customer: on with a verified email subscribes at once, with an unverified one sends
 * the confirmation link; off unsubscribes the account's own subscriber (and the one with its verified address).
 */
export async function setAccountSubscription(
  storeId: string,
  customerId: string,
  on: boolean,
  consent: { text: string; locale: string; marketCode: string | null; source?: SubscribeSource; sourceRef?: string | null },
): Promise<SubscriberStatus | null> {
  const customer = await accountCustomer(storeId, customerId);
  if (!customer) return null;
  if (on) {
    const joined = await joinList({
      storeId,
      email: customer.email,
      locale: customer.locale ?? consent.locale,
      marketCode: consent.marketCode,
      source: consent.source ?? "account",
      sourceRef: consent.sourceRef ?? null,
      consentText: consent.text,
      customerId: customer.id,
      proof: customer.emailVerified ? "account" : "link",
    });
    // An unverified customer is never told an address is subscribed already: they are asked to open the link, as anyone typing it would be.
    return customer.emailVerified && joined.status !== "pending" ? "subscribed" : "pending";
  }
  await db().execute(sql`
    update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'account'
    where store_id = ${storeId}::uuid and status <> 'unsubscribed'
      and (customer_id = ${customer.id}::uuid or (${customer.emailVerified} and lower(email) = ${normal(customer.email)}))
  `);
  return "unsubscribed";
}

// ---------------------------------------------------------------------------
// The admin's list
// ---------------------------------------------------------------------------

export type SubscriberCounts = Record<SubscriberStatus, number>;

export async function subscriberCounts(storeId: string): Promise<SubscriberCounts> {
  const rows = await db().execute<Row>(sql`
    select status, count(*)::int as n from commerce.marketing_subscribers where store_id = ${storeId}::uuid group by status
  `);
  const counts = Object.fromEntries(SUBSCRIBER_STATUSES.map((s) => [s, 0])) as SubscriberCounts;
  for (const row of rows) counts[String(row.status) as SubscriberStatus] = Number(row.n);
  return counts;
}

export type SubscriberRow = {
  id: string;
  email: string;
  name: string;
  status: SubscriberStatus;
  source: SubscribeSource;
  locale: string;
  confirmed: boolean;
  customer: boolean;
  /** When they joined (consented) or left. */
  at: string;
};

export const SUBSCRIBERS_PAGE = 50;

/** Newest first, by address search and status, 50 a page (keyset on the time and id). */
export async function listSubscribers(
  storeId: string,
  options: { query?: string; status?: SubscriberStatus | null; before?: { at: string; id: string } | null } = {},
): Promise<{ rows: SubscriberRow[]; more: boolean }> {
  const words = (options.query ?? "").trim().toLowerCase().slice(0, 100);
  const like = `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db().execute<Row>(sql`
    select id, email, name, status, source, locale, confirmed_at is not null as confirmed, customer_id is not null as customer,
      coalesce(unsubscribed_at, consented_at) as at
    from commerce.marketing_subscribers
    where store_id = ${storeId}::uuid
      and (${options.status ?? null}::text is null or status = ${options.status ?? null})
      and (${words} = '' or lower(email) like ${like} or lower(name) like ${like})
      and (${options.before?.at ?? null}::timestamptz is null
        or (coalesce(unsubscribed_at, consented_at), id) < (${options.before?.at ?? null}::timestamptz, ${options.before?.id ?? null}::uuid))
    order by coalesce(unsubscribed_at, consented_at) desc, id desc
    limit ${SUBSCRIBERS_PAGE + 1}
  `);
  return {
    rows: rows.slice(0, SUBSCRIBERS_PAGE).map((r) => ({
      id: String(r.id),
      email: String(r.email),
      name: String(r.name ?? ""),
      status: String(r.status) as SubscriberStatus,
      source: String(r.source) as SubscribeSource,
      locale: String(r.locale),
      confirmed: Boolean(r.confirmed),
      customer: Boolean(r.customer),
      at: new Date(String(r.at)).toISOString(),
    })),
    more: rows.length > SUBSCRIBERS_PAGE,
  };
}

export type SubscriberDetail = SubscriberRow & {
  marketCode: string | null;
  consentText: string;
  consentedAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  unsubscribeSource: UnsubscribeSource | null;
  history: { kind: ConsentEventKind; source: string; consentText: string | null; at: string }[];
};

export async function subscriberDetail(storeId: string, id: string): Promise<SubscriberDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await db().execute<Row>(sql`
    select s.*, coalesce(s.unsubscribed_at, s.consented_at) as at,
      (select coalesce(json_agg(json_build_object('kind', e.kind, 'source', e.source, 'consentText', e.consent_text, 'at', e.created_at) order by e.id), '[]')
         from commerce.marketing_consent_events e where e.store_id = s.store_id and e.subscriber_id = s.id) as history
    from commerce.marketing_subscribers s
    where s.store_id = ${storeId}::uuid and s.id = ${id}::uuid
  `);
  if (!r) return null;
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ""),
    status: String(r.status) as SubscriberStatus,
    source: String(r.source) as SubscribeSource,
    locale: String(r.locale),
    confirmed: r.confirmed_at != null,
    customer: r.customer_id != null,
    at: iso(r.at)!,
    marketCode: r.market_code ? String(r.market_code) : null,
    consentText: String(r.consent_text),
    consentedAt: iso(r.consented_at)!,
    confirmedAt: iso(r.confirmed_at),
    unsubscribedAt: iso(r.unsubscribed_at),
    unsubscribeSource: r.unsubscribe_source ? (String(r.unsubscribe_source) as UnsubscribeSource) : null,
    history: ((r.history ?? []) as { kind: ConsentEventKind; source: string; consentText: string | null; at: string }[]).map((e) => ({
      ...e,
      at: new Date(e.at).toISOString(),
    })),
  };
}

/** Staff unsubscribing a person who asked by other means (`marketing:write`), audited with the id only. */
export async function unsubscribeByStaff(storeId: string, accountId: string, id: string): Promise<boolean> {
  const left = await leave(storeId, id, "staff");
  if (left) await audit(accountId, storeId, "subscribers.unsubscribed", { subscriber: id }, { target: { type: "subscriber", id } });
  return left;
}

/** Every row with its consent facts, as a CSV (owner only, a POST); audited with the count only, never an address. */
export async function subscribersCsv(storeId: string, accountId: string): Promise<{ csv: string; count: number }> {
  const rows = await db().execute<Row>(sql`
    select email, name, status, locale, market_code, source, consent_text, consented_at, confirmed_at, unsubscribed_at, unsubscribe_source,
      customer_id is not null as customer, created_at
    from commerce.marketing_subscribers where store_id = ${storeId}::uuid
    order by created_at, id
  `);
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : "");
  const csv = writeCsv([
    [...SUBSCRIBER_CSV_COLUMNS],
    ...rows.map((r) => [
      String(r.email),
      String(r.name ?? ""),
      String(r.status),
      String(r.locale),
      r.market_code ? String(r.market_code) : "",
      String(r.source),
      String(r.consent_text),
      iso(r.consented_at),
      iso(r.confirmed_at),
      iso(r.unsubscribed_at),
      r.unsubscribe_source ? String(r.unsubscribe_source) : "",
      r.customer ? "yes" : "no",
      iso(r.created_at),
    ]),
  ]);
  await audit(accountId, storeId, "subscribers.exported", { count: rows.length });
  return { csv, count: rows.length };
}

/** Sign-ups whose link ran out more than 30 days ago go, with their history (the daily cron). */
export async function pruneSubscribers(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.marketing_subscribers
    where status = 'pending' and confirm_until < now() - make_interval(days => ${PENDING_KEEP_DAYS})
    returning 1
  `);
  return rows.length;
}
