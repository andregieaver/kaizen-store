import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock, type RenderedEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { formatMoney } from "@/lib/money";
import { dayWords } from "@/lib/payment-terms";
import { DISPUTE_STATUS_WORDS, disputeDashboardUrl, disputeNeedsResponse, disputeReasonWords, dueWords, type DisputeStatus } from "@/lib/payment-facts";
import { permissionsOf } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";
import {
  ALERT_KEYS,
  ALERT_LABELS,
  STAFF_ALERT_EVENTS,
  localNow,
  memberMayReceive,
  recipientsFor,
  summaryChoiceProblem,
  summaryDue,
  type AlertChoices,
  type AlertMember,
  type AlertRecipient,
  type StaffAlertEvent,
  type SummaryKind,
} from "@/lib/staff-alerts";

import { audit } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import { getOrder } from "./orders";
import { emailFooter, storeById, type EmailStore } from "./shopper-emails";
import { takeTestSlot, TESTS_PER_HOUR } from "./notifications";
import { staffSummaryFigures, type StaffSummaryFigures } from "./staff-summary";
import { uuidList } from "./sql-arrays";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/**
 * Staff alerts (wave 3, D238, `docs/wave-3-notifications.md` 2.4, 2.8, 4.7 and 4.8). **The only reader and writer of `staff_alert_settings` and
 * `staff_alert_recipients`** (a scan test), and the consumer of `store_events`. Every query names the store.
 *
 * - **Who**: `alertRecipients(storeId, event)`: the members the owner chose (or the defaults while the page was never saved: owners get new orders, returns
 *   requested and low stock; a refund overdue goes to the contact address, or the owners when there is none) whose membership still lets them read what
 *   the email shows (`ALERT_NEEDS`, checked at sending through the same permission arithmetic as `memberCan()`), and the store's contact address when it
 *   is chosen. Only active, unexpired members with an address of an open store; never an address typed anywhere.
 * - **The queue**: `processStoreEvents()` (every minute) claims due events (a five-minute lease, `for update skip locked`), runs the rules first
 *   (`runRulesFor()`, `rules_done_at`) and then the alerts (`alerts_done_at`), one email per recipient with a key per event and recipient, so a retried
 *   webhook, a replayed session or a second run sends nothing more. A failure is tried again after 1, 5, 15 and 60 minutes, then every 6 hours, at most
 *   10 tries, then `failed_at` (shown on the store's Home).
 * - **What an email holds**: order and return numbers, line titles and quantities, the total charged in the order's currency, the delivery method and
 *   country, the buyer's kind, host, gift and hold flags, store figures and links into the admin. **Never** a buyer's name, email, phone, address, company
 *   name, VAT number, gift message, note, reason or token (4.8).
 * - English, as every staff email.
 */

const LEASE_MINUTES = 5;
/** Waits after the 1st, 2nd, 3rd and 4th failed try; every later one waits 6 hours (2.11). */
const BACKOFF_MINUTES = [1, 5, 15, 60];
const LATER_MINUTES = 360;
export const MAX_ATTEMPTS = 10;
/** Lines a new-order or return email lists at most (then "and {n} more"). */
const LINES_SHOWN = 20;

const en = () => emailText("en");

// ---------------------------------------------------------------------------
// Members, choices and recipients
// ---------------------------------------------------------------------------

type Member = AlertMember & { email: string; name: string | null };

/** The store's members who could receive staff email: active, not expired, with an address, of an open store (none otherwise). */
async function alertMembers(storeId: string): Promise<Member[]> {
  const rows = await db().execute<Row>(sql`
    select distinct on (a.id) a.id, a.email, a.name, m.role = 'owner' as owner, m.kind, m.role_id, r.permissions
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
    join commerce.stores s on s.id = m.store_id
    left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
    where m.store_id = ${storeId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      and a.email <> '' and commerce.store_is_active(s.id)
    order by a.id, (m.role = 'owner') desc
  `);
  return rows.map((r) => {
    const holder = {
      role: r.owner ? ("owner" as const) : ("admin" as const),
      kind: r.kind === "collaborator" ? ("collaborator" as const) : ("staff" as const),
      permissions: r.role_id ? ((r.permissions ?? []) as string[]).map(String) : null,
    };
    return { accountId: String(r.id), email: String(r.email), name: r.name ? String(r.name) : null, owner: Boolean(r.owner), permissions: permissionsOf(holder) };
  });
}

type Settings = {
  choices: AlertChoices;
  contactEmail: string | null;
  summary: SummaryKind;
  summaryWeekday: number;
  summaryHour: number;
  summaryLastPeriod: string | null;
};

async function readSettings(storeId: string): Promise<Settings> {
  const [[row], recipients] = await Promise.all([
    db().execute<Row>(sql`
      select s.contact_email, a.configured_at, a.summary, a.summary_weekday, a.summary_hour, a.summary_last_period, a.contact_events
      from commerce.stores s left join commerce.staff_alert_settings a on a.store_id = s.id
      where s.id = ${storeId}::uuid
    `),
    db().execute<Row>(sql`select account_id, events from commerce.staff_alert_recipients where store_id = ${storeId}::uuid`),
  ]);
  const contactEmail = row?.contact_email ? String(row.contact_email).trim() || null : null;
  return {
    choices: {
      configuredAt: row?.configured_at ? new Date(String(row.configured_at)).toISOString() : null,
      recipients: recipients.map((r) => ({ accountId: String(r.account_id), events: ((r.events ?? []) as string[]).map(String) })),
      contactEvents: ((row?.contact_events ?? []) as string[]).map(String),
      hasContact: contactEmail !== null,
    },
    contactEmail,
    summary: ((row?.summary as SummaryKind | undefined) ?? "off") as SummaryKind,
    summaryWeekday: Number(row?.summary_weekday ?? 1),
    summaryHour: Number(row?.summary_hour ?? 8),
    summaryLastPeriod: row?.summary_last_period ? String(row.summary_last_period) : null,
  };
}

export type AlertTarget = { recipient: AlertRecipient; to: string };

/** Who receives an event's email now, with the address each is sent to (4.7). */
export async function alertRecipients(storeId: string, event: StaffAlertEvent): Promise<AlertTarget[]> {
  const [members, settings] = await Promise.all([alertMembers(storeId), readSettings(storeId)]);
  const byId = new Map(members.map((m) => [m.accountId, m]));
  return recipientsFor(event, members, settings.choices).flatMap((recipient): AlertTarget[] => {
    if (recipient.kind === "contact") return settings.contactEmail ? [{ recipient, to: settings.contactEmail }] : [];
    const member = byId.get(recipient.accountId);
    return member ? [{ recipient, to: member.email }] : [];
  });
}

export type StaffAlertsView = {
  configured: boolean;
  members: { accountId: string; name: string | null; email: string; owner: boolean; may: Record<StaffAlertEvent, boolean>; events: StaffAlertEvent[] }[];
  contact: { email: string; events: StaffAlertEvent[] } | null;
  summary: SummaryKind;
  summaryWeekday: number;
  summaryHour: number;
};

/** What the staff alerts page shows (2.4): each member with the events they may receive and get now (the defaults while it was never saved). */
export async function staffAlertsView(storeId: string): Promise<StaffAlertsView> {
  const [members, settings] = await Promise.all([alertMembers(storeId), readSettings(storeId)]);
  const current = (event: StaffAlertEvent) => new Set(recipientsFor(event, members, settings.choices).map((r) => (r.kind === "contact" ? "contact" : r.accountId)));
  const byEvent = new Map(STAFF_ALERT_EVENTS.map((e) => [e, current(e)]));
  return {
    configured: settings.choices.configuredAt !== null,
    members: members.map((m) => ({
      accountId: m.accountId,
      name: m.name,
      email: m.email,
      owner: m.owner,
      may: Object.fromEntries(STAFF_ALERT_EVENTS.map((e) => [e, memberMayReceive(m, e)])) as Record<StaffAlertEvent, boolean>,
      events: STAFF_ALERT_EVENTS.filter((e) => byEvent.get(e)?.has(m.accountId)),
    })),
    contact: settings.contactEmail ? { email: settings.contactEmail, events: STAFF_ALERT_EVENTS.filter((e) => byEvent.get(e)?.has("contact")) } : null,
    summary: settings.summary,
    summaryWeekday: settings.summaryWeekday,
    summaryHour: settings.summaryHour,
  };
}

const eventList = z.array(z.enum(STAFF_ALERT_EVENTS)).max(STAFF_ALERT_EVENTS.length).transform((list) => [...new Set(list)]);

export const staffAlertsInput = z.object({
  recipients: z.array(z.object({ accountId: z.uuid(), events: eventList })).max(500),
  contactEvents: eventList,
  summary: z.enum(["off", "daily", "weekly"]),
  summaryWeekday: z.coerce.number().int(),
  summaryHour: z.coerce.number().int(),
});

export type SaveStaffAlertsResult = { ok: true } | { ok: false; problem: "not_owner" | "invalid" | "not_member" | "not_allowed" | "no_contact"; message: string };

/**
 * Saves the whole staff alerts page at once (2.4 point 4), for an owner only (the page asks `requireOwnerRole()`, and this asks again): each recipient must
 * be a member who may receive each of their events, the contact address's events need a contact address. From then on the choices hold, not the defaults.
 * Audited `notification.staff_saved` with how many recipients each event has, never an address.
 */
export async function saveStaffAlerts(storeId: string, input: unknown, accountId: string): Promise<SaveStaffAlertsResult> {
  const [owner] = await db().execute<Row>(sql`
    select 1 from commerce.store_members where store_id = ${storeId}::uuid and account_id = ${accountId}::uuid and role = 'owner' and disabled_at is null
      and (expires_at is null or expires_at > now())
  `);
  if (!owner) return { ok: false, problem: "not_owner", message: "Only an owner chooses who gets staff alerts." };
  const parsed = staffAlertsInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: "invalid", message: parsed.error.issues[0]?.message ?? "Check the choices and try again." };
  const data = parsed.data;
  const problem = summaryChoiceProblem({ summary: data.summary, weekday: data.summaryWeekday, hour: data.summaryHour });
  if (problem) return { ok: false, problem: "invalid", message: problem };
  const [members, settings] = await Promise.all([alertMembers(storeId), readSettings(storeId)]);
  const byId = new Map(members.map((m) => [m.accountId, m]));
  for (const r of data.recipients) {
    const member = byId.get(r.accountId);
    if (!member) return { ok: false, problem: "not_member", message: "Someone chosen is not a member of this store any more. Load the page again." };
    const refused = r.events.find((e) => !memberMayReceive(member, e));
    if (refused) return { ok: false, problem: "not_allowed", message: `${member.name ?? member.email} cannot receive ${ALERT_LABELS[refused]} emails: their role does not let them read what it shows.` };
  }
  if (data.contactEvents.length > 0 && !settings.contactEmail) return { ok: false, problem: "no_contact", message: "The store has no contact address. Add one under Company details first." };
  const chosen = data.recipients.filter((r) => r.events.length > 0);
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      insert into commerce.staff_alert_settings (store_id, configured_at, summary, summary_weekday, summary_hour, contact_events, updated_by)
      values (${storeId}::uuid, now(), ${data.summary}, ${data.summaryWeekday}, ${data.summaryHour}, ${`{${data.contactEvents.join(",")}}`}::text[], ${accountId}::uuid)
      on conflict (store_id) do update set configured_at = now(), summary = excluded.summary, summary_weekday = excluded.summary_weekday,
        summary_hour = excluded.summary_hour, contact_events = excluded.contact_events, updated_by = excluded.updated_by, updated_at = now()
    `);
    await tx.execute(sql`delete from commerce.staff_alert_recipients where store_id = ${storeId}::uuid`);
    for (const r of chosen) {
      await tx.execute(sql`
        insert into commerce.staff_alert_recipients (store_id, account_id, events)
        values (${storeId}::uuid, ${r.accountId}::uuid, ${`{${r.events.join(",")}}`}::text[])
      `);
    }
  });
  const counts = Object.fromEntries(
    STAFF_ALERT_EVENTS.map((e) => [e, chosen.filter((r) => r.events.includes(e)).length + (data.contactEvents.includes(e) ? 1 : 0)]),
  );
  await audit(accountId, storeId, "notification.staff_saved", { recipients: counts, summary: data.summary });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The emails (4.8: no shopper's personal field in any of them)
// ---------------------------------------------------------------------------

const adminUrl = (slug: string, path: string) => `${siteUrl()}/admin/${slug}${path}`;
const countryName = (code: string | null | undefined) => {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

/** Lines as `{quantity} × {title}`, at most 20, then "and {n} more". */
function lineRows(lines: readonly { title: string; quantity: number }[]): EmailBlock[] {
  const shown = lines.slice(0, LINES_SHOWN);
  const more = lines.length - shown.length;
  return [
    { type: "lines", rows: shown.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: "" })) },
    ...(more > 0 ? [{ type: "paragraph" as const, text: `…and ${more} more.` }] : []),
  ];
}

export type NewOrderFacts = {
  number: string;
  totalMinor: number;
  /** What is left to pay at the venue (D66 `venue` or `deposit`): charged now is the total less this. 0 when the whole was charged. */
  balanceMinor?: number;
  currency: string;
  locale: string;
  lines: { title: string; quantity: number }[];
  delivery: string;
  country: string | null;
  business: boolean;
  host: string | null;
  gift: boolean;
  heldByRule: boolean;
  renewal: boolean;
};

/** The new-order email (2.8): number, total, lines, delivery and country, flags and the link. Pure over the facts, which hold no personal field. */
export function newOrderEmail(store: EmailStore, orderId: string, f: NewOrderFacts): RenderedEmail {
  const total = formatMoney(f.totalMinor, f.currency, f.locale);
  const balance = Math.min(Math.max(f.balanceMinor ?? 0, 0), f.totalMinor);
  const charged = formatMoney(f.totalMinor - balance, f.currency, f.locale);
  const due = formatMoney(balance, f.currency, f.locale);
  // An appointment paid at the venue, or by a deposit (D66): the order's total is not what was charged, and the email says both.
  const amounts =
    balance > 0
      ? [
          { label: "Order total", value: total, strong: true },
          { label: "Charged now", value: charged },
          { label: "Due at the venue", value: due },
        ]
      : [{ label: "Total charged", value: total, strong: true }];
  const flags = [
    f.renewal ? "Subscription renewal" : null,
    f.business ? "Business buyer" : null,
    f.host ? `Host's listing: ${f.host}` : null,
    f.gift ? "Gift" : null,
    f.heldByRule ? "On hold by a rule" : null,
  ].filter((x): x is string => x !== null);
  return renderEmail({
    subject: `New order ${f.number}: ${total}`,
    preview: `${store.name} has a new paid order, ${f.number}, of ${total}.`,
    lang: "en",
    footer: emailFooter(store, en()),
    blocks: [
      { type: "heading", text: "New order" },
      { type: "paragraph", text: balance > 0 ? `Order ${f.number} of ${total} is confirmed: ${charged} charged now, ${due} due at the venue.` : `Order ${f.number} is paid: ${total}.` },
      ...lineRows(f.lines),
      { type: "lines", rows: amounts },
      { type: "paragraph", text: [`Delivery: ${f.delivery}`, f.country ? `Country: ${f.country}` : null].filter(Boolean).join("\n") },
      ...(flags.length > 0 ? [{ type: "paragraph" as const, text: flags.join("\n") }] : []),
      { type: "button", text: "Open the order", url: adminUrl(store.slug, `/orders/${orderId}`) },
    ],
  });
}

/** The facts of a paid order for its staff email, or null when it gets none: copied, a weekly box's delivery, cancelled, anonymised, or not found. */
async function newOrderFacts(storeId: string, orderId: string): Promise<NewOrderFacts | null> {
  const [row] = await db().execute<Row>(sql`
    select o.status::text as status, o.copied_from is not null as copied, o.anonymised_at is not null as anonymised, o.restricted_at is not null as restricted,
      o.held_by_rule is not null and o.held_at is not null as held_by_rule,
      exists (select 1 from commerce.standing_deliveries d where d.store_id = o.store_id and d.order_id = o.id) as box,
      (select h.name from commerce.hosts h where h.store_id = o.store_id and h.id = o.host_id) as host_name,
      o.subscription_id is not null and exists (
        select 1 from commerce.orders e where e.store_id = o.store_id and e.subscription_id = o.subscription_id and e.id <> o.id and e.placed_at < o.placed_at
      ) as renewal
    from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
  `);
  if (!row || row.copied || row.box || row.anonymised || row.restricted || row.status === "cancelled" || row.status === "pending_payment") return null;
  const order = await getOrder(storeId, orderId);
  if (!order) return null;
  return {
    number: order.number,
    totalMinor: order.totalMinor,
    balanceMinor: order.balanceMinor,
    currency: order.currency,
    locale: order.locale,
    lines: order.lines.map((l) => ({ title: l.title, quantity: l.quantity })),
    delivery: order.deliveryKept?.label ?? order.delivery?.label ?? (order.deliveryMethod === "pickup" ? "Pickup" : order.deliveryMethod === "local" ? "Local delivery" : order.ships ? "Shipping" : "No delivery"),
    country: countryName(order.shippingAddress?.country ?? (order.ships ? order.marketCode : null)),
    business: order.company !== null,
    host: row.host_name ? String(row.host_name) : null,
    gift: order.gift !== null,
    heldByRule: Boolean(row.held_by_rule),
    renewal: Boolean(row.renewal),
  };
}

export type ReturnFacts = { number: string; orderNumber: string; kind: "withdrawal" | "return"; lines: { title: string; quantity: number }[] };

/** The return-requested email (2.8): the return and order numbers, the lines, *Withdrawal* or *Return* and the link; no reason note. */
export function returnRequestedEmail(store: EmailStore, returnId: string, f: ReturnFacts): RenderedEmail {
  const what = f.kind === "withdrawal" ? "Withdrawal" : "Return";
  return renderEmail({
    subject: `${what} requested: ${f.number} (order ${f.orderNumber})`,
    preview: `A customer asked to send back items of order ${f.orderNumber}.`,
    lang: "en",
    footer: emailFooter(store, en()),
    blocks: [
      { type: "heading", text: f.kind === "withdrawal" ? "A customer withdrew" : "A return was requested" },
      { type: "paragraph", text: `${what} ${f.number} for order ${f.orderNumber}.` },
      ...lineRows(f.lines),
      { type: "button", text: "Open the return", url: adminUrl(store.slug, `/returns/${returnId}`) },
    ],
  });
}

async function returnFacts(storeId: string, returnId: string): Promise<ReturnFacts | null> {
  const [row] = await db().execute<Row>(sql`
    select r.number, r.kind, o.number as order_number, o.copied_from is not null as copied, o.anonymised_at is not null or o.restricted_at is not null as gone
    from commerce.returns r join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
  `);
  if (!row || row.copied || row.gone) return null;
  const lines = await db().execute<Row>(sql`
    select ol.title, rl.quantity from commerce.return_lines rl
    join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
    where rl.store_id = ${storeId}::uuid and rl.return_id = ${returnId}::uuid order by ol.title, ol.id
  `);
  return {
    number: String(row.number),
    orderNumber: String(row.order_number),
    kind: row.kind === "withdrawal" ? "withdrawal" : "return",
    lines: lines.map((l) => ({ title: String(l.title), quantity: Number(l.quantity) })),
  };
}

/** The staff summary email (2.8): the period's figures with a link each; nothing per customer. */
export function summaryEmail(store: EmailStore, kind: "daily" | "weekly", f: StaffSummaryFigures): RenderedEmail {
  const money = (minor: number) => formatMoney(minor, f.currency, "en-GB");
  const period = kind === "daily" ? `yesterday (${f.to})` : `the week ${f.from} to ${f.to}`;
  const rows = [
    { label: "Paid orders", value: String(f.orders) },
    { label: "Net sales, excl. VAT", value: money(f.netSalesMinor), strong: true },
    { label: "Refunds, excl. VAT", value: money(f.refundsMinor) },
    { label: "Returns requested", value: String(f.returnsRequested) },
  ];
  const open = [
    { label: "Open returns", value: String(f.openReturns) },
    { label: "Orders to send", value: String(f.toSend) },
    { label: "Variants at or below their stock level", value: String(f.lowStock) },
    ...(f.supportWaiting !== null ? [{ label: "Conversations waiting in support", value: String(f.supportWaiting) }] : []),
  ];
  return renderEmail({
    subject: `${store.name}: ${kind === "daily" ? "daily" : "weekly"} summary for ${kind === "daily" ? f.to : `${f.from} to ${f.to}`}`,
    preview: f.orders === 0 ? `No orders ${kind === "daily" ? "yesterday" : "last week"}.` : `${f.orders} paid ${f.orders === 1 ? "order" : "orders"}, ${money(f.netSalesMinor)} net.`,
    lang: "en",
    footer: emailFooter(store, en()),
    blocks: [
      { type: "heading", text: kind === "daily" ? "Your day" : "Your week" },
      { type: "paragraph", text: f.orders === 0 ? `No orders ${kind === "daily" ? "yesterday" : "in the week"}. This is ${period}.` : `This is ${period}, in your store's own days.` },
      { type: "lines", rows },
      ...(f.unconverted > 0
        ? [{ type: "paragraph" as const, text: `${f.unconverted} ${f.unconverted === 1 ? "order or refund" : "orders or refunds"} in ${f.missingCurrencies.join(", ")} are not included: no exchange rate.` }]
        : []),
      { type: "paragraph", text: "Now:" },
      { type: "lines", rows: open },
      { type: "button", text: "Open Analytics", url: adminUrl(store.slug, "/analytics") },
      { type: "button", text: "Open Orders", url: adminUrl(store.slug, "/orders") },
    ],
  });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const DONE: readonly SendOutcome[] = ["sent", "logged", "duplicate", "suppressed"];

/** Sends one email to each target with its key; whether every one is kept (a failure is tried again with the same keys). */
async function sendToAll(
  storeId: string,
  storeName: string,
  kind: string,
  targets: readonly AlertTarget[],
  email: RenderedEmail,
  key: (r: AlertRecipient) => string,
  orderId: string | null,
  send: typeof sendEmail,
): Promise<{ ok: boolean; outcomes: SendOutcome[] }> {
  const outcomes: SendOutcome[] = [];
  for (const t of targets) outcomes.push(await send({ storeId, kind, to: t.to, email, fromName: storeName, idempotencyKey: key(t.recipient), orderId }));
  return { ok: outcomes.every((o) => DONE.includes(o)), outcomes };
}

/** The new-order email to each recipient of `new_order` (2.8). Null when the order gets none. */
export async function sendNewOrderAlert(storeId: string, orderId: string, send: typeof sendEmail = sendEmail): Promise<{ ok: boolean; sent: number } | null> {
  const [facts, store, targets] = await Promise.all([newOrderFacts(storeId, orderId), storeById(storeId), alertRecipients(storeId, "new_order")]);
  if (!facts || !store) return null;
  if (targets.length === 0) return { ok: true, sent: 0 };
  // The order's own id, never its staff email's: the email log lists staff emails with their order, and the erasure of D162 holds them back with it.
  const result = await sendToAll(storeId, store.name, "staff.new_order", targets, newOrderEmail(store, orderId, facts), (r) => ALERT_KEYS.newOrder(orderId, r), orderId, send);
  return { ok: result.ok, sent: result.outcomes.filter((o) => o === "sent" || o === "logged").length };
}

/** The return-requested email to each recipient of `return_requested` (2.8). */
export async function sendReturnRequestedAlert(storeId: string, returnId: string, send: typeof sendEmail = sendEmail): Promise<{ ok: boolean; sent: number } | null> {
  const [facts, store, targets] = await Promise.all([returnFacts(storeId, returnId), storeById(storeId), alertRecipients(storeId, "return_requested")]);
  if (!facts || !store) return null;
  if (targets.length === 0) return { ok: true, sent: 0 };
  const [order] = await db().execute<Row>(sql`select order_id from commerce.returns where store_id = ${storeId}::uuid and id = ${returnId}::uuid`);
  const result = await sendToAll(
    storeId,
    store.name,
    "staff.return_requested",
    targets,
    returnRequestedEmail(store, returnId, facts),
    (r) => ALERT_KEYS.returnRequested(returnId, r),
    order ? String(order.order_id) : null,
    send,
  );
  return { ok: result.ok, sent: result.outcomes.filter((o) => o === "sent" || o === "logged").length };
}

export type DisputeFacts = {
  orderNumber: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
  status: DisputeStatus;
  /** The evidence deadline in the store's own time zone, in words; null when Stripe gave none. */
  due: string | null;
  dashboardUrl: string;
};

/** A dispute's staff email (D288): opened, or its deadline near. The order's number, the amount, Stripe's reason and the deadline; never who the customer is. */
export function disputeEmail(store: EmailStore, kind: "opened" | "due", f: DisputeFacts): RenderedEmail {
  const amount = formatMoney(f.amountMinor, f.currency, "en-GB");
  const needs = disputeNeedsResponse(f.status);
  return renderEmail({
    subject: kind === "opened" ? `Payment disputed: order ${f.orderNumber}, ${amount}` : `Dispute evidence due${f.due ? ` ${f.due}` : ""}: order ${f.orderNumber}`,
    preview: kind === "opened" ? `The customer's bank disputed ${amount} of order ${f.orderNumber}.` : `Send Stripe your evidence for order ${f.orderNumber} before the deadline.`,
    lang: "en",
    footer: emailFooter(store, en()),
    blocks: [
      { type: "heading", text: kind === "opened" ? "A payment was disputed" : "A dispute's deadline is near" },
      {
        type: "paragraph",
        text:
          kind === "opened"
            ? `The customer's bank disputed ${amount} of order ${f.orderNumber}. Stripe holds the amount until the dispute is decided.`
            : `Stripe needs your evidence for the dispute on order ${f.orderNumber}. Without it the dispute is lost.`,
      },
      {
        type: "lines",
        rows: [
          { label: "Amount", value: amount, strong: true },
          { label: "Reason", value: disputeReasonWords(f.reason) },
          { label: "Status", value: DISPUTE_STATUS_WORDS[f.status] },
          ...(f.due ? [{ label: needs ? "Evidence due" : "Deadline", value: f.due }] : []),
        ],
      },
      { type: "paragraph", text: "Evidence is sent in your Stripe Dashboard." },
      { type: "button", text: "Open the dispute in Stripe", url: f.dashboardUrl },
      { type: "button", text: "Open the order", url: adminUrl(store.slug, `/orders/${f.orderId}`) },
    ],
  });
}

async function disputeFacts(storeId: string, disputeId: string): Promise<DisputeFacts | null> {
  const [row] = await db().execute<Row>(sql`
    select d.amount_minor, d.currency, d.reason, d.status, d.evidence_due_by, d.provider_reference, d.test_mode, o.id as order_id, o.number,
      o.copied_from is not null as copied, s.time_zone
    from commerce.payment_disputes d
    join commerce.orders o on o.store_id = d.store_id and o.id = d.order_id
    join commerce.stores s on s.id = d.store_id
    where d.store_id = ${storeId}::uuid and d.id = ${disputeId}::uuid
  `);
  if (!row || row.copied) return null;
  return {
    orderNumber: String(row.number),
    orderId: String(row.order_id),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency).trim(),
    reason: row.reason ? String(row.reason) : null,
    status: String(row.status) as DisputeStatus,
    due: row.evidence_due_by ? dueWords(new Date(String(row.evidence_due_by)), String(row.time_zone ?? "UTC")) : null,
    dashboardUrl: disputeDashboardUrl(String(row.provider_reference), Boolean(row.test_mode)),
  };
}

/** A dispute's email to each recipient of `dispute` (D288), once per recipient and kind. Null when it gets none (a copied order). */
export async function sendDisputeAlert(storeId: string, disputeId: string, kind: "opened" | "due", send: typeof sendEmail = sendEmail): Promise<{ ok: boolean; sent: number } | null> {
  const [facts, store, targets] = await Promise.all([disputeFacts(storeId, disputeId), storeById(storeId), alertRecipients(storeId, "dispute")]);
  if (!facts || !store) return null;
  if (targets.length === 0) return { ok: true, sent: 0 };
  const result = await sendToAll(
    storeId,
    store.name,
    kind === "opened" ? "staff.dispute" : "staff.dispute_due",
    targets,
    disputeEmail(store, kind, facts),
    (r) => (kind === "opened" ? ALERT_KEYS.disputeOpened(disputeId, r) : ALERT_KEYS.disputeDue(disputeId, r)),
    facts.orderId,
    send,
  );
  return { ok: result.ok, sent: result.outcomes.filter((o) => o === "sent" || o === "logged").length };
}

/** A held card's deadline is a day away (D289): to the recipients of new orders, once per order; the order's number and amount, never who the customer is. */
export async function sendCaptureDueAlert(storeId: string, orderId: string, send: typeof sendEmail = sendEmail): Promise<{ ok: boolean; sent: number } | null> {
  const [[row], store, targets] = await Promise.all([
    db().execute<Row>(sql`
      select o.number, o.total_minor, o.currency, o.capture_before, o.copied_from is not null as copied, s.time_zone
        from commerce.orders o join commerce.stores s on s.id = o.store_id
       where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.status = 'authorized'
    `),
    storeById(storeId),
    alertRecipients(storeId, "new_order"),
  ]);
  if (!row || row.copied || !store) return null;
  if (targets.length === 0) return { ok: true, sent: 0 };
  const amount = formatMoney(Number(row.total_minor), String(row.currency).trim(), "en-GB");
  const due = dueWords(new Date(String(row.capture_before)), String(row.time_zone ?? "UTC"));
  const email = renderEmail({
    subject: `Capture the payment of order ${String(row.number)} by ${due}`,
    preview: `The card is held for ${amount}. After ${due} the hold ends and the order is cancelled.`,
    lang: "en",
    footer: emailFooter(store, en()),
    blocks: [
      { type: "heading", text: "A held payment is about to end" },
      { type: "paragraph", text: `The customer's card is held for ${amount} on order ${String(row.number)}. Capture it by ${due}; after that Stripe lets the hold go and the order is cancelled, its stock released.` },
      { type: "button", text: "Open the order", url: adminUrl(store.slug, `/orders/${orderId}`) },
    ],
  });
  const result = await sendToAll(storeId, store.name, "staff.capture_due", targets, email, (r) => `staff-capture-due:${orderId}:${r.kind === "contact" ? "contact" : r.accountId}`, orderId, send);
  return { ok: result.ok, sent: result.outcomes.filter((o) => o === "sent" || o === "logged").length };
}

/**
 * An order on payment terms was not paid by its due day (D293): to the alert's recipients (owners by default), once per order and recipient; the order's
 * number, the amount owed and the day it was due, never who the customer or the company is.
 */
export async function sendTermsOverdueAlert(storeId: string, orderId: string, send: typeof sendEmail = sendEmail): Promise<{ ok: boolean; sent: number } | null> {
  const [[row], store, targets] = await Promise.all([
    db().execute<Row>(sql`
      select o.number, o.balance_minor, o.currency, t.due_on::text as due_on, o.copied_from is not null as copied
        from commerce.orders o join commerce.order_payment_terms t on t.store_id = o.store_id and t.order_id = o.id
       where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and t.paid_at is null
    `),
    storeById(storeId),
    alertRecipients(storeId, "payment_overdue"),
  ]);
  if (!row || row.copied || !store) return null;
  if (targets.length === 0) return { ok: true, sent: 0 };
  const amount = formatMoney(Number(row.balance_minor), String(row.currency).trim(), "en-GB");
  const due = dayWords(String(row.due_on), "en-GB");
  const email = renderEmail({
    subject: `Order ${String(row.number)} is overdue: ${amount} was due on ${due}`,
    preview: `The invoice for order ${String(row.number)} was not paid by its due day.`,
    lang: "en",
    footer: emailFooter(store, en()),
    blocks: [
      { type: "heading", text: "A payment on terms is overdue" },
      { type: "paragraph", text: `${amount} for order ${String(row.number)} was due on ${due} and has not been recorded as paid. The customer has been sent a notice. When the money arrives outside Kaizena Flow, record it on the order.` },
      { type: "button", text: "Open the order", url: adminUrl(store.slug, `/orders/${orderId}`) },
    ],
  });
  const result = await sendToAll(storeId, store.name, ALERT_EMAIL_KINDS.payment_overdue, targets, email, (r) => `staff-terms-overdue:${orderId}:${r.kind === "contact" ? "contact" : r.accountId}`, orderId, send);
  return { ok: result.ok, sent: result.outcomes.filter((o) => o === "sent" || o === "logged").length };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

type Claimed = { id: string; storeId: string; event: "order.paid" | "return.requested"; subjectId: string; attempts: number; alertsDone: boolean; rulesDone: boolean };

/** When to try again after this many tries (2.11): 1, 5, 15 and 60 minutes, then every 6 hours. */
export const retryMinutes = (attempts: number): number => BACKOFF_MINUTES[attempts - 1] ?? LATER_MINUTES;

async function claimEvents(now: Date, limit: number, storeIds: readonly string[] | null): Promise<Claimed[]> {
  const rows = await db().execute<Row>(sql`
    update commerce.store_events e set lease_until = ${now.toISOString()}::timestamptz + make_interval(mins => ${LEASE_MINUTES}), attempts = e.attempts + 1
    where e.id in (
      select id from commerce.store_events
      where (alerts_done_at is null or rules_done_at is null) and failed_at is null and attempts < ${MAX_ATTEMPTS}
        and next_attempt_at <= ${now.toISOString()}::timestamptz and (lease_until is null or lease_until < ${now.toISOString()}::timestamptz)
        ${storeIds ? sql`and store_id = any(${uuidList(storeIds)})` : sql``}
      order by next_attempt_at, id
      limit ${limit}
      for update skip locked
    )
    returning e.id, e.store_id, e.event, e.subject_id, e.attempts, e.alerts_done_at is not null as alerts_done, e.rules_done_at is not null as rules_done
  `);
  return rows.map((r) => ({
    id: String(r.id),
    storeId: String(r.store_id),
    event: r.event as Claimed["event"],
    subjectId: String(r.subject_id),
    attempts: Number(r.attempts),
    alertsDone: Boolean(r.alerts_done),
    rulesDone: Boolean(r.rules_done),
  }));
}

async function markPart(e: Claimed, part: "alerts" | "rules") {
  await db().execute(sql`
    update commerce.store_events set ${part === "alerts" ? sql`alerts_done_at = now()` : sql`rules_done_at = now()`}
    where store_id = ${e.storeId}::uuid and id = ${e.id}::uuid
  `);
}

async function releaseEvent(e: Claimed, now: Date, error: string | null) {
  if (error === null) {
    await db().execute(sql`update commerce.store_events set lease_until = null, last_error = null where store_id = ${e.storeId}::uuid and id = ${e.id}::uuid`);
    return;
  }
  const failed = e.attempts >= MAX_ATTEMPTS;
  await db().execute(sql`
    update commerce.store_events set lease_until = null, last_error = ${error.slice(0, 500)},
      next_attempt_at = ${new Date(now.getTime() + retryMinutes(e.attempts) * 60_000).toISOString()}::timestamptz,
      failed_at = ${failed ? sql`now()` : sql`null`}
    where store_id = ${e.storeId}::uuid and id = ${e.id}::uuid
  `);
}

/** Whether a store takes staff alerts and rules now: open, and selling (`shop` on). */
async function storeServes(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select commerce.store_is_active(${storeId}::uuid) and commerce.feature_on(${storeId}::uuid, 'shop') as on`);
  return Boolean(row?.on);
}

export type QueueRun = { claimed: number; done: number; retried: number; failed: number; emails: number };

/**
 * Works through the due store events (every minute, from `/api/cron/integrations`): per event first the rules, then the alerts, each part marked done so a
 * retry does only what is left. A store that is not open or has the shop off has both parts marked done with nothing sent (4.7). Never throws.
 */
export async function processStoreEvents(
  options: {
    now?: Date;
    limit?: number;
    /** Only these stores' events (a store's own retry, and tests); every store's when absent. */
    storeIds?: readonly string[];
    send?: typeof sendEmail;
    runRules?: (e: { id: string; storeId: string; subjectId: string }) => Promise<void>;
  } = {},
): Promise<QueueRun> {
  const now = options.now ?? new Date();
  const out: QueueRun = { claimed: 0, done: 0, retried: 0, failed: 0, emails: 0 };
  let claimed: Claimed[];
  try {
    claimed = await claimEvents(now, options.limit ?? 100, options.storeIds ?? null);
  } catch (error) {
    console.error("[staff-alerts] the store events could not be claimed", error);
    return out;
  }
  out.claimed = claimed.length;
  const runRules = options.runRules ?? (async (e: { id: string; storeId: string; subjectId: string }) => (await import("./order-rules")).runRulesFor(e));
  for (const e of claimed) {
    try {
      if (!(await storeServes(e.storeId))) {
        if (!e.rulesDone) await markPart(e, "rules");
        if (!e.alertsDone) await markPart(e, "alerts");
        await releaseEvent(e, now, null);
        out.done++;
        continue;
      }
      if (!e.rulesDone) {
        if (e.event === "order.paid") await runRules({ id: e.id, storeId: e.storeId, subjectId: e.subjectId });
        await markPart(e, "rules");
      }
      if (!e.alertsDone) {
        const result =
          e.event === "order.paid"
            ? await sendNewOrderAlert(e.storeId, e.subjectId, options.send)
            : await sendReturnRequestedAlert(e.storeId, e.subjectId, options.send);
        if (result && !result.ok) throw new Error("an email could not be sent");
        out.emails += result?.sent ?? 0;
        await markPart(e, "alerts");
      }
      await releaseEvent(e, now, null);
      out.done++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed";
      await releaseEvent(e, now, message).catch(() => {});
      if (e.attempts >= MAX_ATTEMPTS) out.failed++;
      else out.retried++;
    }
  }
  return out;
}

/** How many of a store's events could not be handled after every try (the Home page's *Staff alerts could not be sent*). */
export async function failedStoreEvents(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.store_events where store_id = ${storeId}::uuid and failed_at is not null and failed_at > now() - interval '30 days'
  `);
  return Number(row?.n ?? 0);
}

/** Deletes store events 30 days after both parts were done or they failed (3.5; application code, no `DELETE` in SQL functions). Returns how many. */
export async function pruneStoreEvents(now = new Date()): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.store_events
    where (alerts_done_at is not null and rules_done_at is not null and greatest(alerts_done_at, rules_done_at) < ${now.toISOString()}::timestamptz - interval '30 days')
       or (failed_at is not null and failed_at < ${now.toISOString()}::timestamptz - interval '30 days')
    returning id
  `);
  return rows.length;
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

/**
 * The daily or weekly summary (five-minute job, 4.7): for each open, selling store with a summary chosen, once its local hour (and weekday) has come and the
 * period was not sent yet: the figures built once, one email per recipient of `summary` (key per store, period and recipient), then the period marked
 * sent. Never throws.
 */
export async function sendDueSummaries(options: { now?: Date; send?: typeof sendEmail } = {}): Promise<{ stores: number; emails: number }> {
  const now = options.now ?? new Date();
  const send = options.send ?? sendEmail;
  const out = { stores: 0, emails: 0 };
  let rows: Row[];
  try {
    rows = await db().execute<Row>(sql`
      select a.store_id, s.slug, s.time_zone, a.summary, a.summary_weekday, a.summary_hour, a.summary_last_period
      from commerce.staff_alert_settings a join commerce.stores s on s.id = a.store_id
      where a.summary <> 'off' and commerce.store_is_active(s.id) and commerce.feature_on(s.id, 'shop')
    `);
  } catch {
    return out;
  }
  for (const row of rows) {
    const storeId = String(row.store_id);
    try {
      const due = summaryDue({
        summary: row.summary as SummaryKind,
        weekday: Number(row.summary_weekday),
        hour: Number(row.summary_hour),
        lastPeriod: row.summary_last_period ? String(row.summary_last_period) : null,
        now: localNow(now, String(row.time_zone ?? "Europe/Oslo")),
      });
      if (!due) continue;
      const [store, emailStore, targets] = await Promise.all([getStore(String(row.slug)), storeById(storeId), alertRecipients(storeId, "summary")]);
      if (!store || !emailStore) continue;
      let ok = true;
      if (targets.length > 0) {
        const figures = await staffSummaryFigures(store, due);
        const result = await sendToAll(storeId, emailStore.name, "staff.summary", targets, summaryEmail(emailStore, row.summary as "daily" | "weekly", figures), (r) => ALERT_KEYS.summary(storeId, due.key, r), null, send);
        ok = result.ok;
        out.emails += result.outcomes.filter((o) => o === "sent" || o === "logged").length;
      }
      if (!ok) continue;
      await db().execute(sql`update commerce.staff_alert_settings set summary_last_period = ${due.key} where store_id = ${storeId}::uuid`);
      out.stores++;
    } catch (error) {
      console.error("[staff-alerts] the summary could not be sent", storeId, error);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export type StaffTestResult = { ok: true; outcome: SendOutcome } | { ok: false; problem: "not_owner" | "limit" | "no_address"; message: string };

/**
 * *Send a test* per event (2.4 point 3): the event's email with made-up facts (no real order), to the owner's own address, kind `staff.test`, the subject
 * prefixed *[Test]*; ten a person an hour, shared with the notification tests.
 */
export async function sendStaffTest(storeId: string, event: StaffAlertEvent, account: { id: string; email: string | null }, now = new Date()): Promise<StaffTestResult> {
  const [owner] = await db().execute<Row>(sql`
    select 1 from commerce.store_members where store_id = ${storeId}::uuid and account_id = ${account.id}::uuid and role = 'owner' and disabled_at is null
  `);
  if (!owner) return { ok: false, problem: "not_owner", message: "Only an owner sends staff alert tests." };
  if (!account.email) return { ok: false, problem: "no_address", message: "Your account has no email address to send the test to." };
  const slot = await takeTestSlot(storeId, account.id, now);
  if (!slot.ok) return { ok: false, problem: "limit", message: `You have sent ${TESTS_PER_HOUR} test emails this hour. Try again after the hour.` };
  const store = await storeById(storeId);
  if (!store) return { ok: false, problem: "not_owner", message: "The store was not found." };
  const currency = store.markets[0]?.nativeCurrency ?? "EUR";
  const sampleLines = [
    { title: "Sample product", quantity: 2 },
    { title: "Another sample product", quantity: 1 },
  ];
  const sampleId = "00000000-0000-4000-8000-000000000000";
  const email: RenderedEmail =
    event === "dispute"
      ? disputeEmail(store, "opened", {
          orderNumber: "1001",
          orderId: sampleId,
          amountMinor: 59700,
          currency,
          reason: "product_not_received",
          status: "needs_response",
          due: dueWords(new Date(now.getTime() + 7 * 86_400_000), "UTC"),
          dashboardUrl: disputeDashboardUrl("dp_test", true),
        })
      : event === "return_requested"
      ? returnRequestedEmail(store, sampleId, { number: "R-1001-1", orderNumber: "1001", kind: "return", lines: sampleLines })
      : event === "summary"
        ? summaryEmail(store, "daily", {
            from: "2026-01-01",
            to: "2026-01-01",
            orders: 3,
            netSalesMinor: 59700,
            refundsMinor: 0,
            currency,
            unconverted: 0,
            missingCurrencies: [],
            returnsRequested: 0,
            openReturns: 1,
            toSend: 2,
            lowStock: 0,
            supportWaiting: null,
          })
        : newOrderEmail(store, sampleId, {
            number: "1001",
            totalMinor: 59700,
            currency,
            locale: "en-GB",
            lines: sampleLines,
            delivery: "Shipping",
            country: countryName(store.details.country),
            business: false,
            host: null,
            gift: false,
            heldByRule: false,
            renewal: false,
          });
  const outcome = await sendEmail({
    storeId,
    kind: "staff.test",
    to: account.email,
    email: { ...email, subject: `[Test] ${email.subject}` },
    fromName: store.name,
    idempotencyKey: `staff-test:${crypto.randomUUID()}`,
  });
  return { ok: true, outcome };
}

/** The kinds of staff email each event sends (for the page and the canary test). */
export const ALERT_EMAIL_KINDS: Record<StaffAlertEvent, string> = {
  new_order: "staff.new_order",
  return_requested: "staff.return_requested",
  refund_overdue: "return.overdue",
  low_stock: "stock.low",
  summary: "staff.summary",
  automation: "automation.notify",
  dispute: "staff.dispute",
  payment_overdue: "staff.payment_overdue",
};
