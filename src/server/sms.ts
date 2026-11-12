import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { normaliseEmail } from "@/lib/email-address";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import {
  SMS_PARTS_MAX,
  SMS_TOKEN_PATTERN,
  campaignEstimate,
  isStopReply,
  maskedPhone,
  nextSendTime,
  normalisePhone,
  phoneCountry,
  smsBody,
  smsCampaignInput,
  smsParts,
  smsSettingsInput,
  withinCap,
  type SmsCampaignStatus,
  type SmsMessageStatus,
  type SmsStopSource,
  type SmsSubscriberStatus,
} from "@/lib/sms";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { NO_ACCESS, memberCan } from "./permissions";
import { segmentPeople, getSegment } from "./segments";
import { encryptionKey } from "./encryption-key";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * SMS marketing (D565, `docs/sms-marketing.md`): the only writer of the `sms_*` tables. A store connects its own 46elks account (its API
 * username and password, kept encrypted; 46elks processes in Sweden); numbers agree at checkout (kept once the order is paid); a campaign goes
 * to every SMS subscriber or a segment's, each text waiting for its recipient's hours, refused before it starts when its estimate (46elks's
 * own dry run) would pass the month's cap and stopped if the month's real cost reaches it. A STOP reply, the stop link in every text, My
 * account or staff end a number's texts at once.
 */

const ELKS = "https://api.46elks.com/a1";
const TIMEOUT_MS = 15_000;
type Fetcher = typeof fetch;

type Credentials = { username: string; password: string };

/** One call to 46elks: form-encoded, Basic auth; the JSON answer or a failure key (`http_401`, `timeout`, `network`), never 46elks's words. */
async function elks(creds: Credentials, method: "GET" | "POST", path: string, form: Record<string, string> | null, fetcher: Fetcher): Promise<{ ok: true; body: unknown } | { ok: false; key: string }> {
  try {
    const response = await fetcher(`${ELKS}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`,
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, key: `http_${response.status}` };
    return { ok: true, body: await response.json() };
  } catch (error) {
    return { ok: false, key: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
}

const meShape = z.object({ currency: z.string().regex(/^[A-Z]{3}$/) });
const numbersShape = z.object({ data: z.array(z.object({ id: z.string(), number: z.string(), capabilities: z.array(z.string()).optional() })) });
const sentShape = z.object({ id: z.string(), status: z.string(), parts: z.number().int().optional(), cost: z.number().optional() });
const dryShape = z.object({ estimated_cost: z.number(), parts: z.number().int().optional() });

/** The addresses 46elks posts a store's replies and delivery reports to: the store named by its inbound key, never by its id. */
export const inboundUrl = (key: string) => `${siteUrl()}/api/sms/${key}/inbound`;
export const deliveredUrl = (key: string) => `${siteUrl()}/api/sms/${key}/delivered`;
/** The stop link in every text. */
export const stopUrl = (token: string) => `${siteUrl()}/sms/${token}`;

// ---------------------------------------------------------------------------------------------------------------- the account and its rules

export type SmsSettingsView = {
  connected: boolean;
  username: string | null;
  currency: string | null;
  sender: string;
  replyNumber: string | null;
  quietFrom: number;
  quietUntil: number;
  /** Whole units of the account's currency. */
  monthlyCap: number;
  /** Spent this calendar month, in whole units (rounded to two decimals). */
  spentThisMonth: number;
};

const settingsRow = z.object({
  api_username: col.text,
  api_password_encrypted: col.text,
  currency: col.currency,
  sender: col.text,
  reply_number: col.textOrNull,
  inbound_key: col.text,
  quiet_from: col.int,
  quiet_until: col.int,
  monthly_cap_units: col.minor,
});
type SettingsRow = z.output<typeof settingsRow>;

const readSettings = (storeId: string) =>
  typedRow(
    settingsRow,
    sql`select api_username, api_password_encrypted, currency, sender, reply_number, inbound_key, quiet_from, quiet_until, monthly_cap_units
        from commerce.sms_settings where store_id = ${storeId}::uuid`,
  );

/** What the month's texts have cost the store so far, in 46elks's units. */
export async function spentThisMonth(storeId: string): Promise<number> {
  const row = await typedRow(
    z.object({ units: col.minor }),
    sql`select coalesce(sum(cost_units), 0) as units from commerce.sms_messages
        where store_id = ${storeId}::uuid and sent_at >= date_trunc('month', now())`,
  );
  return row?.units ?? 0;
}

const unitsToWhole = (units: number) => Math.round(units / 100) / 100;

export async function getSmsSettings(storeId: string): Promise<SmsSettingsView> {
  const row = await readSettings(storeId);
  if (!row) return { connected: false, username: null, currency: null, sender: "", replyNumber: null, quietFrom: 9, quietUntil: 20, monthlyCap: 500, spentThisMonth: 0 };
  return {
    connected: true,
    username: row.api_username,
    currency: row.currency,
    sender: row.sender,
    replyNumber: row.reply_number,
    quietFrom: row.quiet_from,
    quietUntil: row.quiet_until,
    monthlyCap: unitsToWhole(row.monthly_cap_units),
    spentThisMonth: unitsToWhole(await spentThisMonth(storeId)),
  };
}

function credentialsOf(row: SettingsRow): Credentials | null {
  const key = encryptionKey();
  if (!key) return null;
  try {
    return { username: row.api_username, password: decryptSecret(row.api_password_encrypted, key) };
  } catch (error) {
    log("error", "sms.password_unreadable", {}, error);
    return null;
  }
}

export type SmsResult = { ok: true } | { ok: false; problem: string };

const connectInput = smsSettingsInput.extend({
  username: z.string().trim().min(1, "Paste the API username from 46elks.").max(100),
  password: z.string().trim().min(1, "Paste the API password from 46elks.").max(200),
});

/** Points the store's 46elks number's incoming texts at the store's inbound address, so a STOP reply reaches it. */
async function pointReplies(creds: Credentials, number: string, key: string, fetcher: Fetcher): Promise<string | null> {
  const listed = await elks(creds, "GET", "/numbers", null, fetcher);
  if (!listed.ok) return "46elks did not answer about the store's numbers. Try again in a minute.";
  const numbers = numbersShape.safeParse(listed.body);
  const found = numbers.success ? numbers.data.data.find((n) => n.number === number) : undefined;
  if (!found) return "That number is not on this 46elks account. Write it as 46elks shows it, or leave it empty.";
  const set = await elks(creds, "POST", `/numbers/${encodeURIComponent(found.id)}`, { sms_url: inboundUrl(key) }, fetcher);
  return set.ok ? null : "46elks did not take the address for replies. Try again in a minute.";
}

/**
 * Connects the store's 46elks account (the owner's, as it spends money and texts customers): the username and password are checked by
 * asking 46elks for the account (its currency), kept encrypted, and a reply number named has its incoming texts sent here.
 */
export async function connectSms(member: Membership, raw: unknown, fetcher: Fetcher = fetch): Promise<SmsResult> {
  if (!memberCan(member, "owner")) return { ok: false, problem: NO_ACCESS };
  const parsed = connectInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the account's details." };
  const input = parsed.data;
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "Kaizena Flow cannot keep the password yet. Try again later." };
  const creds = { username: input.username, password: input.password };
  const me = await elks(creds, "GET", "/me", null, fetcher);
  if (!me.ok) return { ok: false, problem: me.key === "http_401" ? "46elks did not accept the username and password." : "46elks did not answer. Try again in a minute." };
  const account = meShape.safeParse(me.body);
  if (!account.success) return { ok: false, problem: "46elks answered in a way Kaizena Flow does not know." };
  const existing = await readSettings(member.store.id);
  const inbound = existing?.inbound_key ?? randomBytes(32).toString("base64url");
  if (input.replyNumber) {
    const problem = await pointReplies(creds, input.replyNumber, inbound, fetcher);
    if (problem) return { ok: false, problem };
  }
  await db().execute(sql`
    insert into commerce.sms_settings (store_id, api_username, api_password_encrypted, currency, sender, reply_number, inbound_key, quiet_from, quiet_until, monthly_cap_units, updated_by)
    values (${member.store.id}::uuid, ${input.username}, ${encryptSecret(input.password, key)}, ${account.data.currency}, ${input.sender}, ${input.replyNumber || null},
            ${inbound}, ${input.quietFrom}, ${input.quietUntil}, ${input.monthlyCap * 10_000}, ${member.account.id}::uuid)
    on conflict (store_id) do update set api_username = excluded.api_username, api_password_encrypted = excluded.api_password_encrypted,
      currency = excluded.currency, sender = excluded.sender, reply_number = excluded.reply_number, quiet_from = excluded.quiet_from,
      quiet_until = excluded.quiet_until, monthly_cap_units = excluded.monthly_cap_units, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(member.account.id, member.store.id, "sms.connected", { currency: account.data.currency, replies: Boolean(input.replyNumber) }, { area: "marketing" });
  return { ok: true };
}

/** The account's rules: sender, reply number, quiet hours and the month's cap (the owner's). The password stays as it is. */
export async function saveSmsSettings(member: Membership, raw: unknown, fetcher: Fetcher = fetch): Promise<SmsResult> {
  if (!memberCan(member, "owner")) return { ok: false, problem: NO_ACCESS };
  const parsed = smsSettingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the settings." };
  const input = parsed.data;
  if (input.quietFrom >= input.quietUntil) return { ok: false, problem: "The hours end after they start." };
  const row = await readSettings(member.store.id);
  if (!row) return { ok: false, problem: "Connect a 46elks account first." };
  if (input.replyNumber && input.replyNumber !== row.reply_number) {
    const creds = credentialsOf(row);
    if (!creds) return { ok: false, problem: "Connect the 46elks account again." };
    const problem = await pointReplies(creds, input.replyNumber, row.inbound_key, fetcher);
    if (problem) return { ok: false, problem };
  }
  await db().execute(sql`
    update commerce.sms_settings set sender = ${input.sender}, reply_number = ${input.replyNumber || null}, quiet_from = ${input.quietFrom},
      quiet_until = ${input.quietUntil}, monthly_cap_units = ${input.monthlyCap * 10_000}, updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid
  `);
  await audit(member.account.id, member.store.id, "sms.settings_changed", { cap: input.monthlyCap, from: input.quietFrom, until: input.quietUntil }, { area: "marketing" });
  return { ok: true };
}

/** Disconnects the account: its password is gone, a campaign being sent stops, and its waiting texts are not sent. Numbers and history stay. */
export async function disconnectSms(member: Membership): Promise<SmsResult> {
  if (!memberCan(member, "owner")) return { ok: false, problem: NO_ACCESS };
  await db().transaction(async (tx) => {
    await tx.execute(sql`update commerce.sms_messages set status = 'skipped', error = 'disconnected' where store_id = ${member.store.id}::uuid and status = 'queued'`);
    await tx.execute(sql`update commerce.sms_campaigns set status = 'stopped', stop_reason = 'staff', finished_at = now(), updated_at = now() where store_id = ${member.store.id}::uuid and status = 'sending'`);
    await tx.execute(sql`delete from commerce.sms_settings where store_id = ${member.store.id}::uuid`);
  });
  await audit(member.account.id, member.store.id, "sms.disconnected", {}, { area: "marketing" });
  return { ok: true };
}

/** Whether the store takes SMS consent at checkout: it has an account connected. */
export async function smsOffered(storeId: string): Promise<boolean> {
  const row = await typedRow(z.object({ on: col.bool }), sql`select true as on from commerce.sms_settings where store_id = ${storeId}::uuid`);
  return Boolean(row?.on);
}

// ---------------------------------------------------------------------------------------------------------------- consent

export type CheckoutConsent = {
  storeId: string;
  orderId: string;
  typed: string;
  /** The market's country, for a number typed without its code. */
  country: string;
  locale: string;
  marketCode: string;
  email: string | null;
  customerId: string | null;
  consentText: string;
};

/**
 * Checkout's box ticked (D565): the number's consent with the words shown, kept `pending` on the order until it is paid
 * (`confirmPaidSmsConsents()`). A number already subscribed keeps the consent it gave. False when the number is not one a store may text.
 */
export async function keepCheckoutSms(input: CheckoutConsent): Promise<boolean> {
  const phone = normalisePhone(input.typed, input.country);
  const country = phone ? phoneCountry(phone) : null;
  if (!phone || !country) return false;
  if (!(await smsOffered(input.storeId))) return false;
  const email = input.email ? normaliseEmail(input.email).slice(0, 254) || null : null;
  await db().execute(sql`
    insert into commerce.sms_subscribers (store_id, phone, country, customer_id, email, locale, market_code, status, source, source_ref, consent_text, consented_at, token)
    values (${input.storeId}::uuid, ${phone}, ${country}, ${input.customerId}::uuid, ${email}, ${input.locale}, ${input.marketCode}, 'pending', 'checkout',
            ${input.orderId}, ${input.consentText.slice(0, 1000)}, now(), ${randomBytes(16).toString("base64url")})
    on conflict (store_id, phone) do update set status = 'pending', source = 'checkout', source_ref = excluded.source_ref, consent_text = excluded.consent_text,
      consented_at = now(), locale = excluded.locale, market_code = excluded.market_code, email = coalesce(excluded.email, commerce.sms_subscribers.email),
      customer_id = coalesce(excluded.customer_id, commerce.sms_subscribers.customer_id)
    where commerce.sms_subscribers.status <> 'subscribed'
  `);
  return true;
}

/** A checkout's consent waits this long for its order to be paid, then goes. */
export const SMS_PENDING_DAYS = 7;

/**
 * The job's part (D565): checkout consents whose order is paid become subscriptions; those whose order was not paid within
 * `SMS_PENDING_DAYS` go (and their history with them). `storeId` keeps it to one store (tests).
 */
export async function confirmPaidSmsConsents(options: { storeId?: string } = {}): Promise<{ subscribed: number; dropped: number }> {
  const only = options.storeId ? sql`and s.store_id = ${options.storeId}::uuid` : sql``;
  const subscribed = await db().execute(sql`
    update commerce.sms_subscribers s set status = 'subscribed'
    from commerce.orders o
    where s.status = 'pending' and s.source = 'checkout' and o.store_id = s.store_id and o.id::text = s.source_ref
      and o.status in ('paid', 'fulfilled', 'closed') ${only}
    returning s.id
  `);
  const dropped = await db().execute(sql`
    delete from commerce.sms_subscribers s
    where s.status = 'pending' and s.consented_at < now() - make_interval(days => ${SMS_PENDING_DAYS}) ${only}
    returning s.id
  `);
  return { subscribed: subscribed.length, dropped: dropped.length };
}

/** A signed-in customer's own SMS consent, for My account (D565): whether the store offers it, and their number's state (masked). */
export async function accountSms(storeId: string, customerId: string): Promise<{ offered: boolean; status: SmsSubscriberStatus | null; phone: string | null }> {
  if (!(await smsOffered(storeId))) return { offered: false, status: null, phone: null };
  const row = await typedRow(
    z.object({ status: z.enum(["pending", "subscribed", "unsubscribed"]), phone: col.text }),
    sql`select status, phone from commerce.sms_subscribers where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid
        order by (status = 'subscribed') desc, updated_at desc limit 1`,
  );
  return { offered: true, status: row?.status ?? null, phone: row ? maskedPhone(row.phone) : null };
}

/**
 * My account's switch (D565): on, the signed-in customer's typed number agrees at once with the words shown (their own account, signed in, is
 * the proof; source `account`); off, every number of theirs stops. False when the number is not one a store may text.
 */
export async function setAccountSms(
  input: { storeId: string; customerId: string; email: string; on: boolean; typed: string; country: string; locale: string; marketCode: string; consentText: string },
): Promise<boolean> {
  if (!input.on) {
    await stopNumber(input.storeId, sql`customer_id = ${input.customerId}::uuid`, "account");
    return true;
  }
  const phone = normalisePhone(input.typed, input.country);
  const country = phone ? phoneCountry(phone) : null;
  if (!phone || !country || !(await smsOffered(input.storeId))) return false;
  const email = normaliseEmail(input.email).slice(0, 254) || null;
  await db().execute(sql`
    insert into commerce.sms_subscribers (store_id, phone, country, customer_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${input.storeId}::uuid, ${phone}, ${country}, ${input.customerId}::uuid, ${email}, ${input.locale}, ${input.marketCode}, 'subscribed', 'account',
            ${input.consentText.slice(0, 1000)}, now(), ${randomBytes(16).toString("base64url")})
    on conflict (store_id, phone) do update set status = 'subscribed', source = 'account', source_ref = null, consent_text = excluded.consent_text,
      consented_at = now(), locale = excluded.locale, market_code = excluded.market_code, email = excluded.email, customer_id = excluded.customer_id
    where commerce.sms_subscribers.status <> 'subscribed'
  `);
  return true;
}

async function stopNumber(storeId: string, where: ReturnType<typeof sql>, source: SmsStopSource): Promise<number> {
  const rows = await db().transaction(async (tx) => {
    const stopped = await tx.execute(sql`
      update commerce.sms_subscribers set status = 'unsubscribed', unsubscribe_source = ${source}
      where store_id = ${storeId}::uuid and status <> 'unsubscribed' and ${where}
      returning id
    `);
    // Its texts still waiting are not sent.
    if (stopped.length > 0) {
      await tx.execute(sql`
        update commerce.sms_messages set status = 'skipped', error = 'stopped'
        where store_id = ${storeId}::uuid and status = 'queued' and subscriber_id in (${sql.join(stopped.map((r) => sql`${String(r.id)}::uuid`), sql`, `)})
      `);
    }
    return stopped;
  });
  return rows.length;
}

const storeOfKey = (key: string) =>
  /^[A-Za-z0-9_-]{43}$/.test(key) ? typedRow(z.object({ store_id: col.uuid }), sql`select store_id from commerce.sms_settings where inbound_key = ${key}`) : Promise.resolve(null);

/** A text 46elks received on the store's number: a STOP reply ends that number's texts at once. Anything else is not kept. */
export async function receiveSms(key: string, from: string, message: string): Promise<"stopped" | "ignored" | "unknown"> {
  const store = await storeOfKey(key);
  if (!store) return "unknown";
  if (!isStopReply(message)) return "ignored";
  const phone = normalisePhone(from, null);
  if (!phone) return "ignored";
  const n = await stopNumber(store.store_id, sql`phone = ${phone}`, "reply");
  if (n > 0) log("info", "sms.stopped_by_reply", { storeId: store.store_id });
  return "stopped";
}

/** The stop link's page: the store and the number's state for its token, or null. */
export async function smsTokenView(token: string): Promise<{ storeName: string; locale: string; status: SmsSubscriberStatus; phone: string } | null> {
  if (!SMS_TOKEN_PATTERN.test(token)) return null;
  const row = await typedRow(
    z.object({ name: col.text, locale: col.text, status: z.enum(["pending", "subscribed", "unsubscribed"]), phone: col.text }),
    sql`select st.name, s.locale, s.status, s.phone from commerce.sms_subscribers s join commerce.stores st on st.id = s.store_id where s.token = ${token}`,
  );
  return row ? { storeName: row.name, locale: row.locale, status: row.status, phone: maskedPhone(row.phone) } : null;
}

/** The stop link pressed: that number gets no more texts from the store. */
export async function stopByToken(token: string): Promise<boolean> {
  if (!SMS_TOKEN_PATTERN.test(token)) return false;
  const row = await typedRow(z.object({ store_id: col.uuid }), sql`select store_id from commerce.sms_subscribers where token = ${token}`);
  if (!row) return false;
  await stopNumber(row.store_id, sql`token = ${token}`, "link");
  return true;
}

/** Staff stopping a number for its owner (who asked them to). */
export async function stopByStaff(member: Membership, id: string): Promise<SmsResult> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, problem: "This number is not on the list." };
  const n = await stopNumber(member.store.id, sql`id = ${id}::uuid`, "staff");
  if (n > 0) await audit(member.account.id, member.store.id, "sms.number_stopped", {}, { area: "marketing", target: { type: "sms_subscriber", id } });
  return { ok: true };
}

/** A delivery report: the message's state as 46elks last said it; 46elks saying a number cannot be reached does not stop it (a phone may be off). */
export async function recordDelivery(key: string, providerId: string, status: string): Promise<boolean> {
  const store = await storeOfKey(key);
  if (!store || !/^[a-z0-9]{1,64}$/i.test(providerId)) return false;
  const next: SmsMessageStatus | null = status === "delivered" ? "delivered" : status === "failed" ? "failed" : null;
  if (!next) return true;
  await db().execute(sql`
    update commerce.sms_messages set status = ${next}, delivered_at = case when ${next} = 'delivered' then now() else delivered_at end,
      error = case when ${next} = 'failed' then 'undelivered' else error end
    where store_id = ${store.store_id}::uuid and provider_id = ${providerId} and status = 'sent'
  `);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------- the list, for staff

export type SmsSubscriberRow = { id: string; phone: string; country: string; status: SmsSubscriberStatus; source: string; consentedAt: string; email: string | null };
export type SmsCounts = Record<SmsSubscriberStatus, number>;

export async function smsSubscriberCounts(storeId: string): Promise<SmsCounts> {
  const rows = await typedRows(
    z.object({ status: z.enum(["pending", "subscribed", "unsubscribed"]), n: col.int }),
    sql`select status, count(*)::int as n from commerce.sms_subscribers where store_id = ${storeId}::uuid group by status`,
  );
  const counts: SmsCounts = { pending: 0, subscribed: 0, unsubscribed: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

export async function listSmsSubscribers(storeId: string, limit = 50): Promise<SmsSubscriberRow[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, phone: col.text, country: col.text, status: z.enum(["pending", "subscribed", "unsubscribed"]), source: col.text, consented_at: col.timestamp, email: col.textOrNull }),
    sql`select id, phone, country, status, source, consented_at, email from commerce.sms_subscribers
        where store_id = ${storeId}::uuid order by created_at desc limit ${limit}`,
  );
  return rows.map((r) => ({ id: r.id, phone: maskedPhone(r.phone), country: r.country, status: r.status, source: r.source, consentedAt: r.consented_at, email: r.email }));
}

// ---------------------------------------------------------------------------------------------------------------- campaigns

export type SmsCampaign = {
  id: string;
  title: string;
  text: string;
  segmentId: string | null;
  status: SmsCampaignStatus;
  stopReason: string | null;
  estimate: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  counts: Record<SmsMessageStatus, number>;
  /** What its sent texts cost, in whole units. */
  cost: number;
};

const campaignRow = z.object({
  id: col.uuid,
  title: col.text,
  text: col.text,
  segment_id: col.textOrNull,
  status: z.enum(["draft", "sending", "sent", "stopped"]),
  stop_reason: col.textOrNull,
  estimate_units: col.minorOrNull,
  started_at: col.timestampOrNull,
  finished_at: col.timestampOrNull,
  created_at: col.timestamp,
  counts: z.record(z.string(), z.number()).nullable(),
  cost_units: col.minor,
});

const CAMPAIGN_SELECT = sql`
  select c.id, c.title, c.text, c.segment_id::text, c.status, c.stop_reason, c.estimate_units, c.started_at, c.finished_at, c.created_at,
    (select jsonb_object_agg(status, n) from (select m.status, count(*)::int as n from commerce.sms_messages m where m.store_id = c.store_id and m.campaign_id = c.id group by m.status) x) as counts,
    (select coalesce(sum(m.cost_units), 0) from commerce.sms_messages m where m.store_id = c.store_id and m.campaign_id = c.id) as cost_units
  from commerce.sms_campaigns c`;

const toCampaign = (r: z.output<typeof campaignRow>): SmsCampaign => ({
  id: r.id,
  title: r.title,
  text: r.text,
  segmentId: r.segment_id,
  status: r.status,
  stopReason: r.stop_reason,
  estimate: r.estimate_units === null ? null : unitsToWhole(r.estimate_units),
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  createdAt: r.created_at,
  counts: { queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0, ...(r.counts ?? {}) },
  cost: unitsToWhole(r.cost_units),
});

export async function listSmsCampaigns(storeId: string): Promise<SmsCampaign[]> {
  const rows = await typedRows(campaignRow, sql`${CAMPAIGN_SELECT} where c.store_id = ${storeId}::uuid order by c.created_at desc limit 100`);
  return rows.map(toCampaign);
}

export async function getSmsCampaign(storeId: string, id: string): Promise<SmsCampaign | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await typedRow(campaignRow, sql`${CAMPAIGN_SELECT} where c.store_id = ${storeId}::uuid and c.id = ${id}::uuid`);
  return row ? toCampaign(row) : null;
}

export type SaveCampaignResult = { ok: true; id: string } | { ok: false; problem: string };

/** A draft written or changed (`marketing:write`); a campaign that started is kept as it was sent. */
export async function saveSmsCampaign(member: Membership, id: string | null, raw: unknown): Promise<SaveCampaignResult> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const parsed = smsCampaignInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the text message." };
  const input = parsed.data;
  if (input.segmentId && !(await getSegment(member.store.id, input.segmentId))) return { ok: false, problem: "That segment is not the store's." };
  if (id) {
    const row = await typedRow(
      z.object({ id: col.uuid }),
      sql`update commerce.sms_campaigns set title = ${input.title}, text = ${input.text}, segment_id = ${input.segmentId}::uuid, updated_at = now()
          where store_id = ${member.store.id}::uuid and id = ${id}::uuid and status = 'draft' returning id`,
    );
    return row ? { ok: true, id: row.id } : { ok: false, problem: "Only a draft can be changed." };
  }
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.sms_campaigns (store_id, title, text, segment_id, created_by)
        values (${member.store.id}::uuid, ${input.title}, ${input.text}, ${input.segmentId}::uuid, ${member.account.id}::uuid) returning id`,
  );
  return row ? { ok: true, id: row.id } : { ok: false, problem: "The text message could not be saved." };
}

export async function deleteSmsCampaign(member: Membership, id: string): Promise<SmsResult> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, problem: "Only a draft can be deleted." };
  const rows = await db().execute(sql`delete from commerce.sms_campaigns where store_id = ${member.store.id}::uuid and id = ${id}::uuid and status = 'draft' returning id`);
  return rows.length > 0 ? { ok: true } : { ok: false, problem: "Only a draft can be deleted." };
}

type Recipient = { id: string; phone: string; country: string; locale: string; token: string };

/** Who a campaign reaches now: every subscribed number, or those whose address (or customer) is in the segment. */
async function audienceOf(member: Membership, segmentId: string | null): Promise<Recipient[] | null> {
  const subscribed = await typedRows(
    z.object({ id: col.uuid, phone: col.text, country: col.text, locale: col.text, token: col.text, email: col.textOrNull, customer_id: col.textOrNull }),
    sql`select id, phone, country, locale, token, email, customer_id::text from commerce.sms_subscribers where store_id = ${member.store.id}::uuid and status = 'subscribed'`,
  );
  if (!segmentId) return subscribed;
  const segment = await getSegment(member.store.id, segmentId);
  if (!segment?.rules) return null;
  const { matches } = await import("@/lib/segments");
  const people = await segmentPeople(member.store, new Date(), { rfm: segment.rules.conditions.some((c) => c.kind === "rfm") });
  const now = new Date();
  const emails = new Set<string>();
  const customers = new Set<string>();
  for (const p of people.people) {
    if (!matches(segment.rules, p, now)) continue;
    emails.add(p.email);
    if (p.customerId) customers.add(p.customerId);
  }
  return subscribed.filter((s) => (s.email && emails.has(s.email)) || (s.customer_id && customers.has(s.customer_id)));
}

const langOf = (locale: string) => locale.split("-")[0] || "en";

export type SmsPreview = { ok: true; recipients: number; parts: number; estimate: number; currency: string; spent: number; cap: number; withinCap: boolean; body: string } | { ok: false; problem: string };

/**
 * What a campaign would do if started now: how many it reaches, the parts of its longest text, and its cost from 46elks's own dry run (one per
 * country it reaches, with a real recipient's text), against what the month has spent and its cap.
 */
export async function previewSmsCampaign(member: Membership, id: string, fetcher: Fetcher = fetch): Promise<SmsPreview & { units?: number }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const campaign = await getSmsCampaign(member.store.id, id);
  if (!campaign) return { ok: false, problem: "This text message is not the store's." };
  const settings = await readSettings(member.store.id);
  if (!settings) return { ok: false, problem: "Connect a 46elks account first." };
  const creds = credentialsOf(settings);
  if (!creds) return { ok: false, problem: "Connect the 46elks account again." };
  const recipients = await audienceOf(member, campaign.segmentId);
  if (!recipients) return { ok: false, problem: "Its segment is gone. Choose another, or send it to everyone." };
  const sample = smsBody({ storeName: member.store.name, text: campaign.text, stopUrl: stopUrl("x".repeat(22)), lang: langOf(member.store.localization.locales[0] ?? "en") });
  const parts = smsParts(sample).parts;
  if (parts > SMS_PARTS_MAX) return { ok: false, problem: `The text takes ${parts} messages; shorten it to ${SMS_PARTS_MAX} at most.` };
  const byCountry = new Map<string, Recipient>();
  const counts = new Map<string, number>();
  for (const r of recipients) {
    if (!byCountry.has(r.country)) byCountry.set(r.country, r);
    counts.set(r.country, (counts.get(r.country) ?? 0) + 1);
  }
  const prices = new Map<string, number>();
  for (const [country, r] of byCountry) {
    const body = smsBody({ storeName: member.store.name, text: campaign.text, stopUrl: stopUrl(r.token), lang: langOf(r.locale) });
    const dry = await elks(creds, "POST", "/sms", { from: settings.reply_number ?? settings.sender, to: r.phone, message: body, dryrun: "yes" }, fetcher);
    const parsed = dry.ok ? dryShape.safeParse(dry.body) : null;
    if (!parsed?.success) return { ok: false, problem: "46elks did not give a price. Try again in a minute." };
    prices.set(country, parsed.data.estimated_cost);
  }
  // Each country's dry run priced its whole text (every part), so the parts are counted once.
  const units = campaignEstimate(prices, counts, 1);
  const spent = await spentThisMonth(member.store.id);
  return {
    ok: true,
    recipients: recipients.length,
    parts,
    estimate: unitsToWhole(units),
    units,
    currency: settings.currency,
    spent: unitsToWhole(spent),
    cap: unitsToWhole(settings.monthly_cap_units),
    withinCap: withinCap(spent, units, settings.monthly_cap_units),
    body: sample,
  };
}

/**
 * Starts a draft (`marketing:write`): priced again, refused if it reaches no one or would pass the month's cap, then one message a subscribed
 * number, each waiting for its recipient's hours. The job sends them.
 */
export async function startSmsCampaign(member: Membership, id: string, fetcher: Fetcher = fetch, now = new Date()): Promise<{ ok: true; recipients: number } | { ok: false; problem: string }> {
  const preview = await previewSmsCampaign(member, id, fetcher);
  if (!preview.ok) return preview;
  if (preview.recipients === 0) return { ok: false, problem: "No one is on the list for it yet." };
  if (!preview.withinCap) return { ok: false, problem: `It would cost about ${preview.estimate} ${preview.currency}, past this month's cap of ${preview.cap} ${preview.currency}. Raise the cap or choose fewer people.` };
  const settings = (await readSettings(member.store.id))!;
  const campaign = (await getSmsCampaign(member.store.id, id))!;
  const recipients = (await audienceOf(member, campaign.segmentId)) ?? [];
  const hours = { from: settings.quiet_from, until: settings.quiet_until };
  const started = await db().transaction(async (tx) => {
    const row = await tx.execute(sql`
      update commerce.sms_campaigns set status = 'sending', started_at = now(), estimate_units = ${preview.units ?? 0}, updated_at = now()
      where store_id = ${member.store.id}::uuid and id = ${id}::uuid and status = 'draft' returning id
    `);
    if (row.length === 0) return false;
    for (let i = 0; i < recipients.length; i += 500) {
      const chunk = recipients.slice(i, i + 500);
      await tx.execute(sql`
        insert into commerce.sms_messages (store_id, campaign_id, subscriber_id, send_after)
        values ${sql.join(chunk.map((r) => sql`(${member.store.id}::uuid, ${id}::uuid, ${r.id}::uuid, ${nextSendTime(now, r.country, hours).toISOString()}::timestamptz)`), sql`, `)}
        on conflict (campaign_id, subscriber_id) do nothing
      `);
    }
    return true;
  });
  if (!started) return { ok: false, problem: "It has already been started." };
  await audit(member.account.id, member.store.id, "sms.campaign_started", { recipients: recipients.length, estimate: preview.estimate }, { area: "marketing", target: { type: "sms_campaign", id } });
  return { ok: true, recipients: recipients.length };
}

/** Stops a campaign being sent: its texts still waiting are not sent. */
export async function stopSmsCampaign(member: Membership, id: string): Promise<SmsResult> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, problem: "This text message is not being sent." };
  const done = await stopCampaign(member.store.id, id, "staff");
  if (!done) return { ok: false, problem: "This text message is not being sent." };
  await audit(member.account.id, member.store.id, "sms.campaign_stopped", {}, { area: "marketing", target: { type: "sms_campaign", id } });
  return { ok: true };
}

async function stopCampaign(storeId: string, id: string, reason: "staff" | "cap"): Promise<boolean> {
  return db().transaction(async (tx) => {
    const row = await tx.execute(sql`
      update commerce.sms_campaigns set status = 'stopped', stop_reason = ${reason}, finished_at = now(), updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'sending' returning id
    `);
    if (row.length === 0) return false;
    await tx.execute(sql`update commerce.sms_messages set status = 'skipped', error = ${reason} where store_id = ${storeId}::uuid and campaign_id = ${id}::uuid and status = 'queued'`);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------- the job

/** Texts sent a run at most (46elks takes 100 a minute an account by default and queues the rest). */
const PER_RUN = 300;

export type SmsRun = { consents: { subscribed: number; dropped: number }; sent: number; failed: number; skipped: number; capped: number; finished: number };

/**
 * The five-minute job (D565): checkout consents whose order was paid, then the texts whose hours have come, oldest first. A store whose month
 * reached its cap has its campaigns stopped; a number that stopped since is skipped; a campaign with nothing waiting is done. Never throws for
 * one store: a failure is the message's, logged by key.
 */
export async function runSms(options: { storeId?: string; deadline?: number; fetcher?: Fetcher; now?: Date } = {}): Promise<SmsRun> {
  const fetcher = options.fetcher ?? fetch;
  const deadline = options.deadline ?? Date.now() + 240_000;
  const result: SmsRun = { consents: await confirmPaidSmsConsents({ storeId: options.storeId }), sent: 0, failed: 0, skipped: 0, capped: 0, finished: 0 };
  const only = options.storeId ? sql`and m.store_id = ${options.storeId}::uuid` : sql``;
  const due = await typedRows(
    z.object({
      id: col.uuid,
      store_id: col.uuid,
      campaign_id: col.uuid,
      text: col.text,
      phone: col.text,
      locale: col.text,
      token: col.text,
      status: z.enum(["pending", "subscribed", "unsubscribed"]),
      store_name: col.text,
    }),
    sql`
      select m.id, m.store_id, m.campaign_id, c.text, s.phone, s.locale, s.token, s.status, st.name as store_name
      from commerce.sms_messages m
      join commerce.sms_campaigns c on c.store_id = m.store_id and c.id = m.campaign_id and c.status = 'sending'
      join commerce.sms_subscribers s on s.store_id = m.store_id and s.id = m.subscriber_id
      join commerce.stores st on st.id = m.store_id
      where m.status = 'queued' and m.send_after <= ${(options.now ?? new Date()).toISOString()}::timestamptz ${only}
      order by m.send_after, m.created_at
      limit ${PER_RUN}
    `,
  );
  const settings = new Map<string, { row: SettingsRow; creds: Credentials | null; spent: number } | null>();
  for (const m of due) {
    if (Date.now() > deadline) break;
    if (!settings.has(m.store_id)) {
      const row = await readSettings(m.store_id);
      settings.set(m.store_id, row ? { row, creds: credentialsOf(row), spent: await spentThisMonth(m.store_id) } : null);
    }
    const s = settings.get(m.store_id);
    if (!s || !s.creds) continue;
    if (s.spent >= s.row.monthly_cap_units) {
      if (await stopCampaign(m.store_id, m.campaign_id, "cap")) {
        result.capped++;
        log("warn", "sms.cap_reached", { storeId: m.store_id, campaign: m.campaign_id });
      }
      continue;
    }
    if (m.status !== "subscribed") {
      await db().execute(sql`update commerce.sms_messages set status = 'skipped', error = 'stopped' where store_id = ${m.store_id}::uuid and id = ${m.id}::uuid and status = 'queued'`);
      result.skipped++;
      continue;
    }
    const body = smsBody({ storeName: m.store_name, text: m.text, stopUrl: stopUrl(m.token), lang: langOf(m.locale) });
    const sent = await elks(s.creds, "POST", "/sms", { from: s.row.reply_number ?? s.row.sender, to: m.phone, message: body, whendelivered: deliveredUrl(s.row.inbound_key) }, fetcher);
    const parsed = sent.ok ? sentShape.safeParse(sent.body) : null;
    if (!parsed?.success) {
      const error = sent.ok ? "unknown_answer" : sent.key;
      await db().execute(sql`update commerce.sms_messages set status = 'failed', error = ${error} where store_id = ${m.store_id}::uuid and id = ${m.id}::uuid and status = 'queued'`);
      log("warn", "sms.send_failed", { storeId: m.store_id, error });
      result.failed++;
      continue;
    }
    const cost = Math.max(0, Math.round(parsed.data.cost ?? 0));
    await db().execute(sql`
      update commerce.sms_messages set status = 'sent', provider_id = ${parsed.data.id}, cost_units = ${cost}, parts = ${parsed.data.parts ?? null}, sent_at = now()
      where store_id = ${m.store_id}::uuid and id = ${m.id}::uuid and status = 'queued'
    `);
    s.spent += cost;
    result.sent++;
  }
  // A campaign with nothing left waiting is done.
  const finished = await db().execute(sql`
    update commerce.sms_campaigns c set status = 'sent', finished_at = now(), updated_at = now()
    where c.status = 'sending' ${options.storeId ? sql`and c.store_id = ${options.storeId}::uuid` : sql``}
      and not exists (select 1 from commerce.sms_messages m where m.store_id = c.store_id and m.campaign_id = c.id and m.status = 'queued')
    returning c.id
  `);
  result.finished = finished.length;
  return result;
}
