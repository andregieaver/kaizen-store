import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import {
  daysLeft,
  effectiveDue,
  extendInput,
  extensionLimit,
  extensionProblem,
  EXTENSION_PROBLEM_TEXT,
  isOverdue,
  logRequestInput,
  privacyDeadline,
  receivedInstant,
  receivedProblem,
  refuseInput,
  reminderDue,
  reminderKey,
  type PrivacyChannel,
  type PrivacyKind,
  type PrivacyOutcome,
  type PrivacyStatus,
  type RefusalReason,
  type RequestClock,
} from "@/lib/privacy-request";
import { dueReminderEmail } from "@/lib/privacy-emails";
import { extensionNoticeEmail, privacyLanguage, refusalNoticeEmail } from "@/lib/privacy-text";
import { siteUrl } from "@/lib/site";

import { audit } from "./auth";
import { sendEmail } from "./email";
import { isUniqueViolation, planErasure } from "./privacy-erasure";
import { privacyStore, resolveSubject, type PrivacyStore } from "./privacy-subject";

type Row = Record<string, unknown>;

/**
 * The log of privacy requests and their one-month clock (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 4 and 4): staff log a request that
 * arrived by email, post or phone with the day it was received (the month runs from receipt); they extend it once (a reason, within the first
 * month, to at most three months from receipt: the person is told), refuse it with a reason (the person is told the reasons, the right to
 * complain and to a judicial remedy), close it as "no data held", or cancel it as a mistake. A request is never deleted by staff (the table
 * refuses it for 24 months). Pages call these behind `requirePermission(slug, "customers:write")`; the functions take the actor.
 * The system never emails an address a person typed into a form: the address is the one staff entered from the person's own message, or the
 * one on file.
 */

export type RequestView = RequestClock & {
  id: string;
  kind: PrivacyKind;
  channel: PrivacyChannel;
  status: PrivacyStatus;
  outcome: PrivacyOutcome | null;
  subjectEmail: string | null;
  subjectCustomerId: string | null;
  receivedAt: Date;
  dueAt: Date;
  extendedUntil: Date | null;
  extensionReason: string | null;
  identityDoubtAt: Date | null;
  completedAt: Date | null;
  refusalReason: RefusalReason | null;
  refusalNote: string | null;
  note: string;
  planSummary: unknown;
  steps: Record<string, unknown>;
  handledBy: string | null;
  createdAt: Date;
  /** Whole days until it is due (negative once overdue); null for an answered request. */
  daysLeft: number | null;
  overdue: boolean;
};

const date = (v: unknown): Date | null => (v == null ? null : new Date(String(v)));

function view(r: Row, now: Date): RequestView {
  const clock: RequestClock = {
    status: String(r.status) as PrivacyStatus,
    receivedAt: new Date(String(r.received_at)),
    dueAt: new Date(String(r.due_at)),
    extendedUntil: date(r.extended_until),
  };
  return {
    ...clock,
    id: String(r.id),
    kind: String(r.kind) as PrivacyKind,
    channel: String(r.channel) as PrivacyChannel,
    outcome: r.outcome ? (String(r.outcome) as PrivacyOutcome) : null,
    subjectEmail: r.subject_email ? String(r.subject_email) : null,
    subjectCustomerId: r.subject_customer_id ? String(r.subject_customer_id) : null,
    extensionReason: r.extension_reason ? String(r.extension_reason) : null,
    identityDoubtAt: date(r.identity_doubt_at),
    completedAt: date(r.completed_at),
    refusalReason: r.refusal_reason ? (String(r.refusal_reason) as RefusalReason) : null,
    refusalNote: r.refusal_note ? String(r.refusal_note) : null,
    note: String(r.note ?? ""),
    planSummary: r.plan_summary ?? null,
    steps: (r.steps ?? {}) as Record<string, unknown>,
    handledBy: r.handled_by ? String(r.handled_by) : null,
    createdAt: new Date(String(r.created_at)),
    daysLeft: clock.status === "open" ? daysLeft(clock, now) : null,
    overdue: isOverdue(clock, now),
  };
}

const COLUMNS = sql`id, store_id, kind, channel, status, subject_customer_id, subject_email, received_at, due_at, extended_until, extension_reason,
  identity_doubt_at, completed_at, outcome, refusal_reason, refusal_note, note, plan_summary, steps, handled_by, created_at`;

export type Actor = { storeId: string; accountId: string };

export async function listRequests(storeId: string, opts: { status?: PrivacyStatus | "all"; now?: Date; limit?: number } = {}): Promise<RequestView[]> {
  const now = opts.now ?? new Date();
  const status = opts.status ?? "all";
  const rows = await db().execute<Row>(sql`
    select ${COLUMNS} from commerce.privacy_requests
    where store_id = ${storeId}::uuid and (${status} = 'all' or status = ${status})
    order by (status = 'open') desc, coalesce(extended_until, due_at) asc, received_at desc limit ${opts.limit ?? 200}
  `);
  return rows.map((r) => view(r, now));
}

export async function getRequest(storeId: string, id: string, now: Date = new Date()): Promise<RequestView | null> {
  const [row] = await db().execute<Row>(sql`select ${COLUMNS} from commerce.privacy_requests where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  return row ? view(row, now) : null;
}

/** The open request for a person, by account and/or email (the customer page shows it, and a download or erasure answers it). */
export async function requestFor(storeId: string, ref: { customerId?: string | null; email?: string | null }, now: Date = new Date()): Promise<RequestView | null> {
  const email = (ref.email ?? "").trim().toLowerCase() || null;
  const [row] = await db().execute<Row>(sql`
    select ${COLUMNS} from commerce.privacy_requests
    where store_id = ${storeId}::uuid and status = 'open'
      and ((${email}::text is not null and subject_email = ${email}) or (${ref.customerId ?? null}::uuid is not null and subject_customer_id = ${ref.customerId ?? null}::uuid))
    order by received_at limit 1
  `);
  return row ? view(row, now) : null;
}

/** How many open requests are overdue or due within `DUE_SOON_DAYS`, for the control center and the customer list. */
export async function dueCounts(storeId: string, now: Date = new Date()): Promise<{ open: number; overdue: number; dueSoon: number }> {
  const open = (await listRequests(storeId, { status: "open", now })).filter((r) => r.status === "open");
  const overdue = open.filter((r) => r.overdue).length;
  const dueSoon = open.filter((r) => !r.overdue && r.daysLeft !== null && r.daysLeft <= 7).length;
  return { open: open.length, overdue, dueSoon };
}

export type LogResult = { ok: true; id: string } | { ok: false; problem: string; field?: string };

/** Logs a request that arrived outside the system. The clock runs from the day it was received. */
export async function logRequest(actor: Actor, raw: unknown, now: Date = new Date()): Promise<LogResult> {
  const parsed = logRequestInput.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, problem: issue?.message ?? "Check the form.", field: String(issue?.path[0] ?? "") };
  }
  const input = parsed.data;
  const problem = receivedProblem(input.receivedOn, now);
  if (problem === "future") return { ok: false, problem: "The day cannot be in the future.", field: "receivedOn" };
  if (problem === "too_old") return { ok: false, problem: "That is more than a year ago. Check the date.", field: "receivedOn" };
  const received = receivedInstant(input.receivedOn);
  const subject = await resolveSubject(actor.storeId, { email: input.email }, { channel: "staff" });
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, status, subject_customer_id, subject_email, received_at, due_at, note, handled_by)
      values (${actor.storeId}::uuid, ${input.kind === "export" ? "export" : "erasure"}, 'staff', 'open', ${subject?.customerId ?? null}::uuid, ${input.email},
              ${received.toISOString()}::timestamptz, ${privacyDeadline(received).toISOString()}::timestamptz, ${input.note}, ${actor.accountId}::uuid)
      returning id
    `);
    await audit(actor.accountId, actor.storeId, "privacy.request_logged", { request: String(row.id), requestKind: input.kind, received: input.receivedOn }, { area: "customers", target: { type: "privacy_request", id: String(row.id) } });
    return { ok: true, id: String(row.id) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: "There is already an open erasure request for this address.", field: "email" };
    throw error;
  }
}

async function facts(store: PrivacyStore) {
  return { storeName: store.name, legalName: store.legalName, contactEmail: store.contactEmail, country: store.country };
}

/** The language a person is written to: their account's, else their latest order's, else the store's main language. */
async function languageFor(store: PrivacyStore, r: RequestView): Promise<string> {
  const subject = await resolveSubject(store.id, { customerId: r.subjectCustomerId, email: r.subjectEmail }, { channel: "staff" });
  return privacyLanguage(subject?.locale ?? store.mainLocale);
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export type ActionResult = { ok: true; emailed: boolean } | { ok: false; problem: string };

/** Extends the answer once (Art. 12(3)): within the first month, with the reasons, to at most three months from receipt; the person is told. */
export async function extendRequest(actor: Actor, id: string, raw: unknown, now: Date = new Date()): Promise<ActionResult> {
  const parsed = extendInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Say why the request is extended." };
  const request = await getRequest(actor.storeId, id, now);
  if (!request) return { ok: false, problem: "There is no such request." };
  const refusal = extensionProblem(request, now, parsed.data.reason);
  if (refusal) return { ok: false, problem: EXTENSION_PROBLEM_TEXT[refusal] };
  const until = extensionLimit(request.receivedAt);
  const done = await db().execute(sql`
    update commerce.privacy_requests set extended_until = ${until.toISOString()}::timestamptz, extension_reason = ${parsed.data.reason}, handled_by = coalesce(handled_by, ${actor.accountId}::uuid)
    where store_id = ${actor.storeId}::uuid and id = ${id}::uuid and status = 'open' and extended_until is null returning id
  `);
  if (done.length === 0) return { ok: false, problem: EXTENSION_PROBLEM_TEXT.already_extended };
  await audit(actor.accountId, actor.storeId, "privacy.request_extended", { request: id, until: day(until) }, { area: "customers", target: { type: "privacy_request", id } });
  const store = await privacyStore(actor.storeId);
  let emailed = false;
  if (store && request.subjectEmail) {
    const language = await languageFor(store, request);
    const content = extensionNoticeEmail(language, await facts(store), { receivedDay: day(request.receivedAt), untilDay: day(until), reason: parsed.data.reason });
    const outcome = await sendEmail({
      storeId: actor.storeId,
      kind: "privacy.extended",
      to: request.subjectEmail,
      email: renderEmail(content),
      fromName: store.name,
      replyTo: store.contactEmail,
      idempotencyKey: `privacy.extended:${id}`,
    });
    emailed = outcome === "sent" || outcome === "logged" || outcome === "duplicate";
  }
  return { ok: true, emailed };
}

/** Refuses with a reason (Art. 12(4)): the person is told the reasons, the right to complain to the supervisory authority and to a judicial remedy. */
export async function refuseRequest(actor: Actor, id: string, raw: unknown, now: Date = new Date()): Promise<ActionResult> {
  const parsed = refuseInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Choose a reason." };
  const request = await getRequest(actor.storeId, id, now);
  if (!request) return { ok: false, problem: "There is no such request." };
  if (request.status !== "open") return { ok: false, problem: "Only an open request can be refused." };
  const done = await db().execute(sql`
    update commerce.privacy_requests set status = 'refused', outcome = 'refused', completed_at = ${now.toISOString()}::timestamptz,
      refusal_reason = ${parsed.data.reason}, refusal_note = ${parsed.data.note}, handled_by = coalesce(handled_by, ${actor.accountId}::uuid)
    where store_id = ${actor.storeId}::uuid and id = ${id}::uuid and status = 'open' returning id
  `);
  if (done.length === 0) return { ok: false, problem: "Only an open request can be refused." };
  await audit(actor.accountId, actor.storeId, "privacy.request_refused", { request: id, reason: parsed.data.reason }, { area: "customers", target: { type: "privacy_request", id } });
  const store = await privacyStore(actor.storeId);
  let emailed = false;
  if (store && request.subjectEmail) {
    const language = await languageFor(store, request);
    const content = refusalNoticeEmail(language, await facts(store), { receivedDay: day(request.receivedAt), reason: parsed.data.reason, note: parsed.data.note });
    const outcome = await sendEmail({
      storeId: actor.storeId,
      kind: "privacy.refused",
      to: request.subjectEmail,
      email: renderEmail(content),
      fromName: store.name,
      replyTo: store.contactEmail,
      idempotencyKey: `privacy.refused:${id}`,
    });
    emailed = outcome === "sent" || outcome === "logged" || outcome === "duplicate";
  }
  return { ok: true, emailed };
}

/** Closes a request as "no data held": only when the store holds nothing about the person (the plan is empty). */
export async function closeNoData(actor: Actor, id: string, now: Date = new Date()): Promise<ActionResult> {
  const request = await getRequest(actor.storeId, id, now);
  if (!request) return { ok: false, problem: "There is no such request." };
  if (request.status !== "open") return { ok: false, problem: "Only an open request can be closed." };
  const subject = await resolveSubject(actor.storeId, { customerId: request.subjectCustomerId, email: request.subjectEmail }, { channel: "staff" });
  if (subject) {
    const planned = await planErasure(subject, now);
    const holds = planned ? planned.plan.rows.length > 0 || planned.plan.alsoHappens.subscriptionsCancelled > 0 : false;
    if (holds) return { ok: false, problem: "The store holds data about this person. Download or erase it instead." };
  }
  const done = await db().execute(sql`
    update commerce.privacy_requests set status = 'done', outcome = 'no_data', completed_at = ${now.toISOString()}::timestamptz,
      ${request.kind === "erasure" ? sql`subject_email = null,` : sql``} handled_by = coalesce(handled_by, ${actor.accountId}::uuid)
    where store_id = ${actor.storeId}::uuid and id = ${id}::uuid and status = 'open' returning id
  `);
  if (done.length === 0) return { ok: false, problem: "Only an open request can be closed." };
  await audit(actor.accountId, actor.storeId, "privacy.request_closed", { request: id, outcome: "no_data" }, { area: "customers", target: { type: "privacy_request", id } });
  return { ok: true, emailed: false };
}

/** Cancels a request logged by mistake. It stays in the log (a request is never deleted by staff). */
export async function cancelRequest(actor: Actor, id: string, now: Date = new Date()): Promise<ActionResult> {
  const done = await db().execute(sql`
    update commerce.privacy_requests set status = 'cancelled', outcome = 'cancelled', completed_at = ${now.toISOString()}::timestamptz,
      handled_by = coalesce(handled_by, ${actor.accountId}::uuid)
    where store_id = ${actor.storeId}::uuid and id = ${id}::uuid and status = 'open' returning id
  `);
  if (done.length === 0) return { ok: false, problem: "Only an open request can be cancelled." };
  await audit(actor.accountId, actor.storeId, "privacy.request_cancelled", { request: id }, { area: "customers", target: { type: "privacy_request", id } });
  return { ok: true, emailed: false };
}

/**
 * Records the day staff began to doubt the person is who they say. It pauses nothing in the system (the clock shows as it is; the law's pause is for
 * staff to apply, and the controller should use the authentication it already has: a reply to the address on file).
 */
export async function markIdentityDoubt(actor: Actor, id: string, now: Date = new Date()): Promise<ActionResult> {
  const done = await db().execute(sql`
    update commerce.privacy_requests set identity_doubt_at = coalesce(identity_doubt_at, ${now.toISOString()}::timestamptz)
    where store_id = ${actor.storeId}::uuid and id = ${id}::uuid and status = 'open' returning id
  `);
  if (done.length === 0) return { ok: false, problem: "Only an open request can be marked." };
  await audit(actor.accountId, actor.storeId, "privacy.request_identity_doubt", { request: id }, { area: "customers", target: { type: "privacy_request", id } });
  return { ok: true, emailed: false };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The daily reminders
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Tells every owner of a store about an open request that is due within 7 days, and once when it is overdue (each exactly once, by key). From the
 * daily cron. The email names the request and its day, never the person.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<{ dueSoon: number; overdue: number }> {
  const rows = await db().execute<Row>(sql`select ${COLUMNS} from commerce.privacy_requests where status = 'open' order by received_at limit 1000`);
  const out = { dueSoon: 0, overdue: 0 };
  const stores = new Map<string, PrivacyStore | null>();
  const owners = new Map<string, Row[]>();
  for (const r of rows) {
    const request = view(r, now);
    const which = reminderDue(request, now);
    if (!which) continue;
    const storeId = String(r.store_id);
    if (!stores.has(storeId)) stores.set(storeId, await privacyStore(storeId));
    const store = stores.get(storeId);
    if (!store) continue;
    if (!owners.has(storeId)) {
      owners.set(
        storeId,
        await db().execute<Row>(sql`
          select distinct on (a.id) a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
          where m.store_id = ${storeId}::uuid and m.role = 'owner' and m.disabled_at is null and a.email <> ''
        `),
      );
    }
    const content = dueReminderEmail({
      storeName: store.name,
      kind: which,
      requestId: request.id,
      dueDay: day(effectiveDue(request)),
      requestKind: request.kind,
      url: `${siteUrl()}/admin/${store.slug}/privacy/${request.id}`,
    });
    const email = renderEmail(content);
    let sentAny = false;
    for (const owner of owners.get(storeId) ?? []) {
      const outcome = await sendEmail({
        storeId,
        kind: which === "overdue" ? "privacy.overdue" : "privacy.due",
        to: String(owner.email),
        email,
        fromName: "Kaizen",
        idempotencyKey: `${reminderKey(which, request.id)}:${String(owner.id)}`,
      });
      if (outcome === "sent" || outcome === "logged") sentAny = true;
    }
    if (sentAny) out[which === "overdue" ? "overdue" : "dueSoon"]++;
  }
  return out;
}
