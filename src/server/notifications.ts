import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock, type RenderedEmail } from "@/lib/email-layout";
import {
  cleanSlot,
  filledSlots,
  templateProblems,
  withTemplate,
  TEMPLATE_SLOTS,
  type BuiltSlots,
  type EmailTemplate,
  type PlaceholderValues,
  type TemplateProblem,
  type TemplateSlot,
  type TemplatedSlots,
} from "@/lib/email-template";
import { deliveryEmailText, emailText, type EmailText } from "@/lib/email-text";
import { formatMoney } from "@/lib/money";
import { sampleOrder, samplePlaceholders, type SampleOrder } from "@/lib/notification-sample";
import {
  NOTIFICATIONS,
  isNotificationId,
  isRequiredNotification,
  notificationEnabled,
  notificationOf,
  PLACEHOLDER_NAMES,
  type NotificationDef,
  type PlaceholderName,
} from "@/lib/notifications";
import { storeSiteUrl } from "@/lib/paths";

import { audit } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import { emailFooter, storeById, type EmailStore } from "./shopper-emails";
import { ensureUi } from "./ui-text";

type Row = Record<string, unknown>;

/**
 * The store's customer notifications (wave 3, D238, `docs/wave-3-notifications.md` 2.1, 4.1 and 4.2): the switch per notification and the owner's words
 * per notification and language. **The only module that reads or writes `notification_settings` and `email_templates`** (a scan test). Every query names
 * the store.
 *
 * - `notificationOn()` is the one question every sender of a catalogue kind asks before an automatic or `notify` send; a required one is on without a read,
 *   and a read that fails counts as on (2.11).
 * - `templatesFor()` reads the store's template of one language fresh for each email (not cached: emails are written by jobs and webhooks); a read that
 *   fails is no template (the fixed text is sent). `withTemplate()` decides per slot.
 * - Saving runs `templateProblems()` again and writes nothing while there is a problem; all three slots empty deletes the language's template.
 * - Preview and the test email draw the notification with the sample order (`sampleOrder()`) through the same `withTemplate()` and `renderEmail()`.
 */

const LOCALE = /^[a-z]{2,3}$/;

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

/** Whether the store sends a notification now. Required ones (and ids outside the catalogue) are on without a read; a failed read counts as on. */
export async function notificationOn(storeId: string, id: string): Promise<boolean> {
  const n = notificationOf(id);
  if (!n || n.required) return true;
  try {
    const [row] = await db().execute<Row>(sql`
      select enabled from commerce.notification_settings where store_id = ${storeId}::uuid and notification = ${id}
    `);
    return notificationEnabled(id, row ? Boolean(row.enabled) : undefined);
  } catch {
    return notificationEnabled(id, null);
  }
}

/**
 * SQL: true when the store has a refund email switched off (`order.refunded`, or `return.refunded` for a return's refund), by the same rule as
 * `notificationEnabled()` (a saved switch, else the default). The credit-note job (`sendPendingDocumentNotices()`) sends a refund's credit note on
 * its own then, since no refund email can carry it: a notification switch never silences a document (D159, D238 4.1).
 */
export function refundEmailOffSql(storeId: SQL, which: "order" | "return"): SQL {
  const id = which === "order" ? "order.refunded" : "return.refunded";
  const on = notificationOf(id)?.defaultOn ?? true;
  return on
    ? sql`exists (select 1 from commerce.notification_settings ns where ns.store_id = ${storeId} and ns.notification = ${id} and not ns.enabled)`
    : sql`not exists (select 1 from commerce.notification_settings ns where ns.store_id = ${storeId} and ns.notification = ${id} and ns.enabled)`;
}

/** Every saved switch of a store, by id (the list page and the *Notify* boxes' defaults). */
export async function savedSwitches(storeId: string): Promise<Map<string, boolean>> {
  const rows = await db().execute<Row>(sql`select notification, enabled from commerce.notification_settings where store_id = ${storeId}::uuid`);
  return new Map(rows.map((r) => [String(r.notification), Boolean(r.enabled)]));
}

/** Each switchable notification's state for the store (the order page's *Notify the customer* boxes): true when it is on. */
export async function notificationStates(storeId: string): Promise<Record<string, boolean>> {
  const saved = await savedSwitches(storeId).catch(() => null);
  return Object.fromEntries(NOTIFICATIONS.map((n) => [n.id, notificationEnabled(n.id, saved ? saved.get(n.id) : null)]));
}

export type SwitchResult = { ok: true; enabled: boolean } | { ok: false; problem: "unknown" | "required"; message: string };

/** Switches a notification on or off. A required one is refused (the database refuses it too); audited `notification.switched`. */
export async function setNotification(storeId: string, id: string, enabled: boolean, accountId: string | null): Promise<SwitchResult> {
  if (!isNotificationId(id)) return { ok: false, problem: "unknown", message: "This email is not one Kaizen sends." };
  if (isRequiredNotification(id)) {
    return { ok: false, problem: "required", message: "This email is required and is always sent: it cannot be switched off." };
  }
  await db().execute(sql`
    insert into commerce.notification_settings (store_id, notification, enabled, updated_by)
    values (${storeId}::uuid, ${id}, ${enabled}, ${accountId}::uuid)
    on conflict (store_id, notification) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(accountId, storeId, "notification.switched", { notification: id, enabled });
  return { ok: true, enabled };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const templateOf = (row: Row): EmailTemplate => ({
  subject: row.subject === null || row.subject === undefined ? null : String(row.subject),
  heading: row.heading === null || row.heading === undefined ? null : String(row.heading),
  body: row.body === null || row.body === undefined ? null : String(row.body),
});

/** The language subtag a template is kept under (`nb-NO` → `nb`); null when it is not one. */
export const templateLocale = (lang: string): string | null => {
  const code = lang.split("-")[0]?.toLowerCase() ?? "";
  return LOCALE.test(code) ? code : null;
};

/** A store's template of a notification in one language, or null. */
export async function getTemplate(storeId: string, id: string, lang: string): Promise<EmailTemplate | null> {
  const locale = templateLocale(lang);
  if (!locale || !isNotificationId(id)) return null;
  const [row] = await db().execute<Row>(sql`
    select subject, heading, body from commerce.email_templates
    where store_id = ${storeId}::uuid and notification = ${id} and locale = ${locale}
  `);
  return row ? templateOf(row) : null;
}

/** The template an email of this language uses, read fresh; null when there is none, the notification is not editable or the read fails (2.11). */
export async function templatesFor(storeId: string, id: string, lang: string): Promise<EmailTemplate | null> {
  if (!notificationOf(id)?.editable) return null;
  try {
    return await getTemplate(storeId, id, lang);
  } catch {
    return null;
  }
}

/** Every template of a store: notification → language → the slots it has. */
async function templateSlots(storeId: string): Promise<Map<string, Map<string, { slots: TemplateSlot[]; problems: number }>>> {
  const rows = await db().execute<Row>(sql`
    select notification, locale, subject, heading, body from commerce.email_templates where store_id = ${storeId}::uuid
  `);
  const out = new Map<string, Map<string, { slots: TemplateSlot[]; problems: number }>>();
  for (const row of rows) {
    const id = String(row.notification);
    const template = templateOf(row);
    const byLang = out.get(id) ?? new Map();
    byLang.set(String(row.locale), { slots: filledSlots(template), problems: templateProblems(template, id).length });
    out.set(id, byLang);
  }
  return out;
}

export type NotificationListItem = {
  def: NotificationDef;
  /** On now (a required one always). */
  enabled: boolean;
  /** `on`, `off`, `always` (required) or `fixed` (locked). */
  status: "on" | "off" | "always" | "fixed";
  /** Per language the store offers or keeps a template in: whether it has the store's own text, and which slots. */
  languages: { lang: string; offered: boolean; own: boolean; slots: TemplateSlot[]; invalid: boolean }[];
};

/** The Notifications page's list (2.1 point 1): every notification with its switch and, per language, *Your text* or *Standard text*. */
export async function listNotifications(storeId: string): Promise<NotificationListItem[]> {
  const [saved, slots, store] = await Promise.all([savedSwitches(storeId), templateSlots(storeId), storeById(storeId)]);
  const offered = storeLanguages(store);
  return NOTIFICATIONS.map((def) => {
    const enabled = notificationEnabled(def.id, saved.get(def.id));
    const own = slots.get(def.id) ?? new Map();
    const langs = [...new Set([...offered, ...own.keys()])];
    return {
      def,
      enabled,
      status: !def.editable ? "fixed" : def.required ? "always" : enabled ? "on" : "off",
      languages: langs.map((lang) => {
        const found = own.get(lang);
        return { lang, offered: offered.includes(lang), own: Boolean(found), slots: found?.slots ?? [], invalid: (found?.problems ?? 0) > 0 };
      }),
    };
  });
}

/** The languages a store offers, as template locales (its main language first). */
export function storeLanguages(store: Pick<EmailStore, "localization"> | null): string[] {
  if (!store) return [];
  return [...new Set(store.localization.locales.map((l) => templateLocale(l)).filter((l): l is string => l !== null))];
}

export type SaveTemplateResult =
  | { ok: true; slots: TemplateSlot[]; deleted: boolean }
  | { ok: false; problem: "unknown" | "locked" | "language"; message: string }
  | { ok: false; problem: "invalid"; message: string; problems: TemplateProblem[] };

/**
 * Saves a store's words for a notification in one of its languages (2.1 point 5): refused for a notification outside the catalogue, a locked one, a language
 * the store does not offer, and while `templateProblems()` finds anything (nothing written then). Only the filled slots are kept; all three empty deletes the
 * language's template. Audited `notification.template_saved` or `notification.template_reset` (the notification, the language, which slots; never the words).
 */
export async function saveTemplate(
  storeId: string,
  id: string,
  lang: string,
  input: EmailTemplate,
  accountId: string | null,
): Promise<SaveTemplateResult> {
  const n = notificationOf(id);
  if (!n) return { ok: false, problem: "unknown", message: "This email is not one Kaizen sends." };
  if (!n.editable) return { ok: false, problem: "locked", message: "This email is the legal acknowledgement of a withdrawal and cannot be changed." };
  const locale = templateLocale(lang);
  const store = await storeById(storeId);
  if (!locale || !storeLanguages(store).includes(locale)) {
    return { ok: false, problem: "language", message: "Choose one of the store's languages." };
  }
  const template: EmailTemplate = Object.fromEntries(TEMPLATE_SLOTS.map((slot) => [slot, cleanSlot(input[slot])]));
  const problems = templateProblems(template, id);
  if (problems.length > 0) return { ok: false, problem: "invalid", message: problems[0].message, problems };
  const slots = filledSlots(template);
  if (slots.length === 0) {
    const removed = await removeTemplate(storeId, id, locale);
    if (removed) await audit(accountId, storeId, "notification.template_reset", { notification: id, locale });
    return { ok: true, slots, deleted: true };
  }
  await db().execute(sql`
    insert into commerce.email_templates (store_id, notification, locale, subject, heading, body, updated_by)
    values (${storeId}::uuid, ${id}, ${locale}, ${template.subject ?? null}, ${template.heading ?? null}, ${template.body ?? null}, ${accountId}::uuid)
    on conflict (store_id, notification, locale) do update
      set subject = excluded.subject, heading = excluded.heading, body = excluded.body, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(accountId, storeId, "notification.template_saved", { notification: id, locale, slots });
  return { ok: true, slots, deleted: false };
}

async function removeTemplate(storeId: string, id: string, locale: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.email_templates where store_id = ${storeId}::uuid and notification = ${id} and locale = ${locale} returning locale
  `);
  return rows.length > 0;
}

/**
 * *Use standard text* (and *Delete* of a language no longer offered): deletes the language's template. Any language the store has a template in may be reset,
 * offered or not. Audited `notification.template_reset`.
 */
export async function resetTemplate(storeId: string, id: string, lang: string, accountId: string | null): Promise<{ ok: boolean }> {
  const locale = templateLocale(lang);
  if (!locale || !isNotificationId(id)) return { ok: false };
  const removed = await removeTemplate(storeId, id, locale);
  if (removed) await audit(accountId, storeId, "notification.template_reset", { notification: id, locale });
  return { ok: removed };
}

// ---------------------------------------------------------------------------
// Fixed text, preview and the test email
// ---------------------------------------------------------------------------

/**
 * The fixed subject, heading and intro of a notification in a language, filled with the given values: the words the real builders use (`orderNotice()`,
 * `returnMail()`, `sendOrderConfirmation()`, the change and parcel emails), for the preview and the editor's placeholders.
 */
export function fixedSlots(id: string, lang: string, values: PlaceholderValues): BuiltSlots {
  const v = Object.fromEntries(PLACEHOLDER_NAMES.map((name) => [name, values[name] ?? ""])) as Record<PlaceholderName, string>;
  const text = emailText(lang);
  const delivery = deliveryEmailText(lang);
  const store = v.store_name;
  const number = v.order_number;
  const r = text.returns;
  switch (id) {
    case "order.confirmation":
      return { subject: text.orderSubject(store, number), heading: text.orderHeading, intro: text.orderIntro(number) };
    case "subscription.renewed":
      return { subject: text.renewalSubject(store, number), heading: text.orderHeading, intro: text.renewalIntro(number) };
    case "order.changed":
      return { subject: text.orderChanged.subject(store, number), heading: text.orderChanged.heading, intro: text.orderChanged.intro(number) };
    case "order.sent":
      return { subject: text.shippedSubject(store, number), heading: text.shippedHeading, intro: text.shippedIntro(number) };
    case "order.parcel_out_for_delivery":
      return { subject: text.parcelOutSubject(store, number), heading: text.parcelOutHeading, intro: text.parcelOutIntro(v.carrier, number) };
    case "order.parcel_delivered":
      return { subject: text.parcelDeliveredSubject(store, number), heading: text.parcelDeliveredHeading, intro: text.parcelDeliveredIntro(v.carrier, number) };
    case "order.refunded":
      return { subject: text.refundSubject(store, number), heading: text.refundHeading, intro: text.refundIntro(v.refund_amount, number) };
    case "order.cancelled":
      return { subject: text.cancelledSubject(store, number), heading: text.cancelledHeading, intro: text.cancelledIntro(number, v.order_total) };
    case "order.ready_for_pickup":
      return { subject: delivery.readySubject(store, number), heading: delivery.readyHeading, intro: delivery.readyIntro(number) };
    case "order.out_for_delivery":
      return { subject: delivery.outSubject(store, number), heading: delivery.outHeading, intro: delivery.outIntro(number) };
    case "return.acknowledgement":
      return { subject: r.ackSubject(store, number), heading: r.ackHeading, intro: r.ackIntro(store, number, new Date().toLocaleDateString(lang)) };
    case "return.approved":
      return { subject: r.approvedSubject(store, v.return_number), heading: r.approvedHeading, intro: r.approvedIntro(v.return_number) };
    case "return.declined":
      return { subject: r.declinedSubject(store, v.return_number), heading: r.declinedHeading, intro: r.declinedIntro(v.return_number) };
    case "return.received":
      return { subject: r.receivedSubject(store, v.return_number), heading: r.receivedHeading, intro: r.receivedIntro(v.return_number) };
    case "return.refunded":
      return { subject: r.refundedSubject(store, v.return_number), heading: r.refundedHeading, intro: r.refundedIntro(v.refund_amount, v.return_number) };
    default:
      return { subject: text.orderSubject(store, number), heading: text.orderHeading, intro: text.orderIntro(number) };
  }
}

/** Stand-ins for the parts the code adds that need a real order (2.1 point 3): said in English, in brackets, so the preview is not taken for a real email. */
const STAND_INS: Record<string, string[]> = {
  "order.confirmation": ["[Kaizen adds: the VAT statement, the invoice link and the right of withdrawal]"],
  "subscription.renewed": ["[Kaizen adds: the invoice link and the subscription's details]"],
  "order.changed": ["[Kaizen adds: what changed, the refund or what is left to pay, and the change's documents]"],
  "order.sent": ["[Kaizen adds: the parcel's contents, the tracking link, the delivery address and the right of withdrawal]"],
  "order.parcel_out_for_delivery": ["[Kaizen adds: the parcel's contents and the tracking link]"],
  "order.parcel_delivered": ["[Kaizen adds: the parcel's contents and the tracking link]"],
  "order.refunded": ["[Kaizen adds: the credit note and, for a reverse-charge order, the VAT note]"],
  "order.cancelled": [],
  "order.ready_for_pickup": ["[Kaizen adds: the place, its opening hours, what to collect and what to bring]"],
  "order.out_for_delivery": ["[Kaizen adds: the delivery area's information and where it goes]"],
  "return.acknowledgement": ["[Kaizen adds: the goods withdrawn, the reference and the dates the law requires]"],
  "return.approved": ["[Kaizen adds: the goods, who pays for sending them back, the return address and the label]"],
  "return.declined": ["[Kaizen adds: your reason and the statement that statutory rights are not affected]"],
  "return.received": ["[Kaizen adds: what happens next]"],
  "return.refunded": ["[Kaizen adds: how the amount was worked out and when it arrives]"],
};

/** The sample order's market for a language: the store's country in that language when it has one, its currency the country's own. */
function sampleMarket(store: EmailStore, lang: string): { currency: string; locale: string } {
  const locale = store.localization.locales.find((l) => templateLocale(l) === lang) ?? store.markets[0]?.ownLocale ?? "en-GB";
  const market = store.markets.find((m) => templateLocale(m.ownLocale) === lang) ?? store.markets[0];
  return { currency: market?.nativeCurrency ?? "EUR", locale };
}

export type NotificationPreview = {
  email: RenderedEmail;
  /** The slots as drawn (the subject among them) and which came from the template. */
  slots: TemplatedSlots;
  /** The fixed text for each slot, filled with the sample (the editor's placeholders). */
  standard: BuiltSlots;
  /** What is wrong with the template shown (the draft or the saved one). */
  problems: TemplateProblem[];
  sample: SampleOrder;
};

/**
 * The notification as it would be sent, in one language, with the sample order and the store's real name and footer (2.1 point 3): the draft as typed, else
 * the saved template, else the fixed text; a slot with a problem is drawn as the fixed text, and the problems are returned with it. Null for an id outside the
 * catalogue or a store that does not exist.
 */
export async function previewNotification(storeId: string, id: string, lang: string, draft?: EmailTemplate | null, now = new Date()): Promise<NotificationPreview | null> {
  const n = notificationOf(id);
  const locale = templateLocale(lang);
  if (!n || !locale) return null;
  await ensureUi();
  const store = await storeById(storeId);
  if (!store) return null;
  const market = sampleMarket(store, locale);
  const sample = sampleOrder({ storeName: store.name, currency: market.currency, locale: market.locale, lang: locale, now });
  const values = samplePlaceholders(sample, store.name);
  const standard = fixedSlots(id, locale, values);
  const template = !n.editable ? null : draft !== undefined && draft !== null ? draft : await templatesFor(storeId, id, locale);
  const problems = template ? templateProblems(template, id) : [];
  const slots = withTemplate(standard, template, id, values);
  const text: EmailText = emailText(locale);
  const money = (minor: number) => formatMoney(minor, sample.currency, sample.locale);
  const ordered = ["order.confirmation", "subscription.renewed", "order.sent", "order.parcel_out_for_delivery", "order.parcel_delivered", "order.ready_for_pickup"].includes(id);
  const blocks: EmailBlock[] = [
    { type: "heading", text: slots.heading },
    { type: "paragraph", text: slots.intro },
    ...(ordered
      ? [
          {
            type: "lines" as const,
            rows: [
              ...sample.lines.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: id === "order.confirmation" || id === "subscription.renewed" ? money(l.totalMinor) : "" })),
              ...(id === "order.confirmation" || id === "subscription.renewed" ? [{ label: text.total, value: money(sample.totalMinor), strong: true }] : []),
            ],
          },
        ]
      : []),
    ...(STAND_INS[id] ?? []).map((t) => ({ type: "paragraph" as const, text: t })),
    { type: "button", text: id.startsWith("return.") ? text.returns.statusButton : text.seeOrder, url: storeSiteUrl(store.slug) },
  ];
  const email = renderEmail({ subject: slots.subject, preview: slots.preview, blocks, footer: emailFooter(store, text), lang: locale });
  return { email, slots, standard, problems, sample };
}

/** Test emails a person may send in a clock hour (the notification editor's and the staff alerts page's together). */
export const TESTS_PER_HOUR = 10;

/** Takes one of a person's test emails of this hour; false (and the time it opens again) when the ten are used. */
export async function takeTestSlot(storeId: string, accountId: string, now = new Date()): Promise<{ ok: true } | { ok: false; opensAt: string }> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${`notify:test:${accountId}`}, date_trunc('hour', ${now.toISOString()}::timestamptz), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count, date_trunc('hour', ${now.toISOString()}::timestamptz) + interval '1 hour' as opens_at
  `);
  if (Number(row?.count ?? 0) <= TESTS_PER_HOUR) return { ok: true };
  return { ok: false, opensAt: new Date(String(row.opens_at)).toISOString() };
}

export type TestResult = { ok: true; outcome: SendOutcome } | { ok: false; problem: "unknown" | "limit" | "no_address"; message: string; opensAt?: string };

/**
 * *Send a test* (2.1 point 4): the previewed email (the draft as typed, or the saved text) to the signed-in person's own account address, never another,
 * kind `notification.test`, the subject prefixed *[Test]*, a key of its own each time; at most 10 a person an hour.
 */
export async function sendTestNotification(
  storeId: string,
  id: string,
  lang: string,
  draft: EmailTemplate | null,
  account: { id: string; email: string | null },
  now = new Date(),
): Promise<TestResult> {
  if (!account.email) return { ok: false, problem: "no_address", message: "Your account has no email address to send the test to." };
  const preview = await previewNotification(storeId, id, lang, draft, now);
  if (!preview) return { ok: false, problem: "unknown", message: "This email is not one Kaizen sends." };
  const slot = await takeTestSlot(storeId, account.id, now);
  if (!slot.ok) {
    const at = new Date(slot.opensAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    return { ok: false, problem: "limit", message: `You have sent ${TESTS_PER_HOUR} test emails this hour. You can send another after ${at} UTC.`, opensAt: slot.opensAt };
  }
  const store = await storeById(storeId);
  const outcome = await sendEmail({
    storeId,
    kind: "notification.test",
    to: account.email,
    email: { ...preview.email, subject: `[Test] ${preview.email.subject}` },
    fromName: store?.name ?? "Kaizen",
    idempotencyKey: `notification-test:${crypto.randomUUID()}`,
  });
  return { ok: true, outcome };
}

// ---------------------------------------------------------------------------
// For the senders
// ---------------------------------------------------------------------------

/** A shopper's first name for `{customer_first_name}`: the first word of the shipping name, else the billing name; null when neither is known (never the email). */
export function firstNameOf(...names: (string | null | undefined)[]): string | null {
  for (const name of names) {
    const first = name?.trim().split(/\s+/)[0];
    if (first) return first;
  }
  return null;
}

/**
 * The subject, heading and intro of a catalogue email as it is sent: the store's template of the email's language applied over the built ones (`withTemplate()`),
 * the placeholders filled with `values`. For an id that is not editable (or not in the catalogue) the built ones as they are.
 */
export async function templatedSlots(storeId: string, id: string, lang: string, built: BuiltSlots, values: PlaceholderValues): Promise<TemplatedSlots> {
  const template = await templatesFor(storeId, id, lang);
  return withTemplate(built, template, id, values);
}
