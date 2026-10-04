import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock, type RenderedEmail } from "@/lib/email-layout";
import { emailText, type EmailText } from "@/lib/email-text";
import { formatMoney } from "@/lib/money";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { formatDeclaration, formatStoreDay } from "@/lib/return-time";
import type { WorkingRow } from "@/lib/return-refund";
import { siteUrl } from "@/lib/site";
import { dayIn } from "@/lib/work-dates";
import { refundDeadline, sendBackDay, type ReturnAddress } from "@/lib/withdrawal";

import { sendEmail, type SendOutcome } from "./email";
import { documentBlocks, recordDocumentDeliveries } from "./invoice-emails";
import { loadFacts, recipientsOf, type OrderFacts } from "./return-facts";
import { NOTHING_SENT_SQL } from "./return-sql";
import { emailContext, emailFooter, type EmailStore } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The emails of withdrawals and returns (D153, `docs/returns.md`): the acknowledgement of a withdrawal (the durable
 * medium the law asks for), a return approved, declined, received and refunded, and the reminder to the store when a
 * refund is overdue. Each is written in the order's language and currency like the other shopper emails
 * (`shopper-emails.ts`), kept in `email_messages` and idempotent by key (`return.{id}.{event}`). The words are
 * `email-text.ts`'s `returns`, hand-written in nb, sv, da and en, and need human (legal) review before real use.
 */

type Ctx = NonNullable<Awaited<ReturnType<typeof emailContext>>>;

type Mail = {
  ret: {
    id: string;
    number: string;
    kind: "withdrawal" | "return";
    status: string;
    instructions: string | null;
    labelUrl: string | null;
    returnAddress: ReturnAddress | null;
    decisionNote: string | null;
    publicToken: string;
    refundDeadline: Date | null;
    refundMinor: number | null;
    refundNote: string | null;
    withdrawalRequestId: string | null;
    /** Withdrawn before the goods were sent: nothing to send back. */
    nothingSent: boolean;
  };
  lines: { title: string; quantity: number; decision: string; exclusion: string; deductionMinor: number; deductionNote: string | null }[];
  request: { id: string; name: string; email: string; confirmedAt: Date | null } | null;
  facts: OrderFacts;
  ctx: Ctx;
};

async function loadMail(storeId: string, returnId: string): Promise<Mail | null> {
  const [r] = await db().execute<Row>(sql`
    select r.id, r.number, r.kind, r.status, r.order_id, r.instructions, r.label_url, r.return_address, r.decision_note,
      r.public_token, r.refund_deadline, r.refund_minor, r.refund_note, r.withdrawal_request_id, ${NOTHING_SENT_SQL} as nothing_sent
    from commerce.returns r where r.store_id = ${storeId}::uuid and r.id = ${returnId}::uuid
  `);
  if (!r) return null;
  const facts = await loadFacts(storeId, String(r.order_id));
  if (!facts || facts.order.copied) return null;
  const [lines, request, ctx] = await Promise.all([
    db().execute<Row>(sql`
      select ol.title, rl.quantity, rl.decision, ol.withdrawal_exclusion, rl.deduction_minor, rl.deduction_note from commerce.return_lines rl
      join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
      where rl.store_id = ${storeId}::uuid and rl.return_id = ${returnId}::uuid order by ol.title, ol.id
    `),
    r.withdrawal_request_id
      ? db().execute<Row>(sql`
          select id, name, email, confirmed_at from commerce.withdrawal_requests
          where store_id = ${storeId}::uuid and id = ${String(r.withdrawal_request_id)}::uuid
        `)
      : Promise.resolve([] as Row[]),
    emailContext(storeId, facts.marketCode, facts.locale, facts.currency),
  ]);
  if (!ctx) return null;
  const address = r.return_address as Partial<ReturnAddress> | null;
  return {
    ret: {
      id: String(r.id),
      number: String(r.number),
      kind: r.kind === "withdrawal" ? "withdrawal" : "return",
      status: String(r.status),
      instructions: r.instructions ? String(r.instructions) : null,
      labelUrl: r.label_url ? String(r.label_url) : null,
      returnAddress: address && address.street ? ({ name: "", postalCode: "", city: "", country: "", ...address } as ReturnAddress) : null,
      decisionNote: r.decision_note ? String(r.decision_note) : null,
      publicToken: String(r.public_token),
      refundDeadline: r.refund_deadline ? new Date(String(r.refund_deadline)) : null,
      refundMinor: r.refund_minor === null || r.refund_minor === undefined ? null : Number(r.refund_minor),
      refundNote: r.refund_note ? String(r.refund_note) : null,
      withdrawalRequestId: r.withdrawal_request_id ? String(r.withdrawal_request_id) : null,
      nothingSent: Boolean(r.nothing_sent),
    },
    lines: lines.map((l) => ({
      title: String(l.title),
      quantity: Number(l.quantity),
      decision: String(l.decision),
      exclusion: String(l.withdrawal_exclusion),
      deductionMinor: Number(l.deduction_minor ?? 0),
      deductionNote: l.deduction_note ? String(l.deduction_note) : null,
    })),
    request: request[0]
      ? {
          id: String(request[0].id),
          name: String(request[0].name),
          email: String(request[0].email),
          confirmedAt: request[0].confirmed_at ? new Date(String(request[0].confirmed_at)) : null,
        }
      : null,
    facts,
    ctx,
  };
}

const statusUrl = (store: EmailStore, marketSlug: string, token: string) =>
  `${storeSiteUrl(store.slug)}${marketPath(store.slug, marketSlug, `/returns/${token}`)}`;

/** The return address to show: the one kept on the return, else the store's postal address. */
function addressLines(mail: Mail): string | null {
  const a = mail.ret.returnAddress;
  if (a) return [a.name, a.street, `${a.postalCode} ${a.city}`.trim(), a.country].filter(Boolean).join("\n");
  return mail.ctx.store.details.postalAddress ?? null;
}

/** The store's own instructions in the order they apply: the return's, else the settings'. */
const instructionsOf = (mail: Mail): string | null => mail.ret.instructions ?? (mail.facts.settings.instructions || null);

const joinLines = (mail: Mail) =>
  mail.lines
    .filter((line) => line.decision === "accept")
    .map((line) => `• ${line.quantity} × ${line.title}`)
    .join("\n");

/** Who pays for sending the goods back: as the store's setting stood when the order was placed, not as it is now. */
function whoPays(text: EmailText, mail: Mail): EmailBlock {
  return { type: "paragraph", text: mail.facts.whoPaysReturn === "store" ? text.returns.storePays : text.returns.shopperPays };
}

/** Sealed goods lose the right only once unsealed: said when the withdrawal holds some. */
const holdsSealed = (mail: Mail) => mail.lines.some((line) => line.decision === "accept" && ["sealed_hygiene", "sealed_media"].includes(line.exclusion));

function instructionBlocks(text: EmailText, mail: Mail): EmailBlock[] {
  const instructions = instructionsOf(mail);
  const address = addressLines(mail);
  return [
    ...(instructions ? [{ type: "paragraph" as const, text: `${text.returns.instructionsHeading}:\n${instructions}` }] : []),
    ...(address ? [{ type: "paragraph" as const, text: `${text.returns.addressHeading}:\n${address}` }] : []),
    ...(mail.ret.labelUrl ? [{ type: "button" as const, text: text.returns.labelButton, url: mail.ret.labelUrl }] : []),
  ];
}

// ---------------------------------------------------------------------------
// The acknowledgement of a withdrawal
// ---------------------------------------------------------------------------

export type Acknowledgement = {
  /** The email as the shopper gets it, and what the confirmation page shows. */
  email: RenderedEmail;
  /** What the email names as the reference: the return's number. */
  reference: string;
  to: string[];
  returnNumber: string;
};

/**
 * Builds the acknowledgement of a confirmed withdrawal: the store, the order, the lines, the date and time in the store's
 * zone with the offset, the reference, and what happens next (the 14 days to send the goods back, who pays, when the
 * refund is made, the store's own instructions and address).
 */
export async function buildAcknowledgement(storeId: string, requestId: string): Promise<Acknowledgement | null> {
  const [ret] = await db().execute<Row>(sql`
    select id from commerce.returns where store_id = ${storeId}::uuid and withdrawal_request_id = ${requestId}::uuid
  `);
  if (!ret) return null;
  const mail = await loadMail(storeId, String(ret.id));
  if (!mail?.request?.confirmedAt) return null;
  const { ctx, facts, request } = mail;
  const { store, market, text } = ctx;
  const confirmedAt = request.confirmedAt!;
  const deadline = mail.ret.refundDeadline ?? refundDeadline(confirmedAt);
  const day = (instant: Date) => formatStoreDay(dayIn(instant, facts.timeZone), market.locale);
  const subject = text.returns.ackSubject(store.name, facts.number);
  const intro = text.returns.ackIntro(store.name, facts.number, formatDeclaration(confirmedAt, market.locale, facts.timeZone));
  const lines = joinLines(mail);
  const blocks: EmailBlock[] = [
    { type: "heading", text: text.returns.ackHeading },
    { type: "paragraph", text: intro },
    { type: "paragraph", text: `${text.returns.ackLinesHeading}:\n${lines}` },
    { type: "paragraph", text: text.returns.ackReference(mail.ret.number) },
    // Nothing was sent when the shopper withdrew: nothing to send back, no return cost, and no refund held for the goods.
    ...(mail.ret.nothingSent
      ? [{ type: "paragraph" as const, text: text.returns.ackNothingSent }]
      : [
          { type: "paragraph" as const, text: text.returns.ackSendBack(formatStoreDay(sendBackDay(confirmedAt, facts.timeZone), market.locale)) },
          whoPays(text, mail),
        ]),
    {
      type: "paragraph",
      text:
        facts.settings.refundWhen === "received" && !mail.ret.nothingSent
          ? text.returns.ackRefundHold(day(deadline))
          : text.returns.ackRefundNoHold(day(deadline)),
    },
    { type: "paragraph", text: text.returns.ackWholeOrder },
    ...(holdsSealed(mail) ? [{ type: "paragraph" as const, text: text.returns.ackSealed }] : []),
    ...(mail.ret.nothingSent ? [] : [{ type: "paragraph" as const, text: text.returns.ackValue }]),
    ...(mail.ret.nothingSent ? [] : instructionBlocks(text, mail)),
    { type: "button", text: text.returns.statusButton, url: statusUrl(store, market.slug, mail.ret.publicToken) },
  ];
  const email = renderEmail({ subject, preview: intro, blocks, footer: emailFooter(store, text), lang: ctx.lang });
  // To the order's own address (and its customer's), never to the address typed into the form.
  const to = recipientsOf(facts);
  return { email, reference: mail.ret.number, to, returnNumber: mail.ret.number };
}

export type AcknowledgementOutcome = {
  /** The email was handed to the email provider: a durable medium. An email only kept (no provider set up) is not sent. */
  sent: boolean;
  outcome: SendOutcome | "unavailable";
  /** `email_messages.id` of the shopper's copy, the acknowledgement's reference on the request. */
  messageId: string | null;
  email: RenderedEmail | null;
  reference: string | null;
};

/**
 * Sends the acknowledgement of a confirmed withdrawal, in the same request as the confirmation, to the order's own address
 * (and its customer's when that differs). The same key never sends twice, so a
 * repeated confirmation does not send again; `resend` (staff, or the retry job) uses a key of its own. Never throws:
 * an email that could not be handed over leaves the withdrawal standing, as "acknowledgement not sent".
 */
export async function sendWithdrawalAcknowledgement(
  storeId: string,
  requestId: string,
  { resend = false }: { resend?: boolean } = {},
): Promise<AcknowledgementOutcome> {
  try {
    const built = await buildAcknowledgement(storeId, requestId);
    if (!built) return { sent: false, outcome: "unavailable", messageId: null, email: null, reference: null };
    const [ret] = await db().execute<Row>(sql`
      select r.order_id, r.id from commerce.returns r where r.store_id = ${storeId}::uuid and r.withdrawal_request_id = ${requestId}::uuid
    `);
    const mail = await loadMail(storeId, String(ret.id));
    if (!mail) return { sent: false, outcome: "unavailable", messageId: null, email: built.email, reference: built.reference };
    const base = `return.ack:${requestId}`;
    const keyFor = (n: number) => (resend ? `${base}:again:${crypto.randomUUID()}` : n === 0 ? base : `${base}:order`);
    let primary: SendOutcome = "failed";
    let primaryKey = "";
    for (const [n, to] of built.to.entries()) {
      const key = keyFor(n);
      const outcome = await sendEmail({
        storeId,
        kind: "return.acknowledgement",
        to,
        email: built.email,
        fromName: mail.ctx.store.name,
        replyTo: mail.ctx.store.details.contactEmail,
        idempotencyKey: key,
        orderId: mail.facts.orderId,
      });
      if (n === 0) {
        primary = outcome;
        primaryKey = key;
      }
    }
    const [message] = primaryKey
      ? await db().execute<Row>(sql`select id, status from commerce.email_messages where idempotency_key = ${primaryKey}`)
      : [];
    // Only an email handed to the provider is an acknowledgement on a durable medium: one that is only kept ("logged": no
    // email provider is set up yet) has not reached the shopper, so it is not recorded as sent and is tried again.
    const sent = message ? ["sent", "delivered"].includes(String(message.status)) : false;
    return {
      sent,
      outcome: primary,
      messageId: sent && message ? String(message.id) : null,
      email: built.email,
      reference: built.reference,
    };
  } catch {
    return { sent: false, outcome: "failed", messageId: null, email: null, reference: null };
  }
}

// ---------------------------------------------------------------------------
// A return's emails
// ---------------------------------------------------------------------------

async function returnMail(
  storeId: string,
  returnId: string,
  event: string,
  kind: string,
  build: (mail: Mail, text: EmailText, money: (minor: number) => string) => { subject: string; heading: string; intro: string; blocks: EmailBlock[] },
  /** The refund's email carries the return's credit note (D159): a link, and the PDF when it exists. */
  withCreditNote = false,
): Promise<SendOutcome | null> {
  const mail = await loadMail(storeId, returnId);
  if (!mail) return null;
  const [to] = recipientsOf(mail.facts);
  if (!to) return null;
  const { store, market, text } = mail.ctx;
  const money = (minor: number) => formatMoney(minor, mail.facts.currency, market.locale);
  const built = build(mail, text, money);
  const documents = withCreditNote
    ? await documentBlocks({ storeId, orderId: mail.facts.orderId, storeSlug: store.slug, marketSlug: market.slug, lang: mail.ctx.lang, want: { creditNoteOfReturn: returnId }, attach: true }).catch(() => null)
    : null;
  const email = renderEmail({
    subject: built.subject,
    preview: built.intro,
    lang: mail.ctx.lang,
    footer: emailFooter(store, text),
    blocks: [
      { type: "heading", text: built.heading },
      { type: "paragraph", text: built.intro },
      ...built.blocks,
      ...(documents?.blocks ?? []),
      { type: "button", text: text.returns.statusButton, url: statusUrl(store, market.slug, mail.ret.publicToken) },
    ],
  });
  const idempotencyKey = `return.${returnId}.${event}`;
  const outcome = await sendEmail({
    storeId,
    kind,
    to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey,
    orderId: mail.facts.orderId,
    ...(documents && documents.attachments.length > 0 ? { attachments: documents.attachments } : {}),
  });
  if (documents && outcome !== "duplicate" && outcome !== "failed" && outcome !== "suppressed") await recordDocumentDeliveries(storeId, documents.docs, { idempotencyKey });
  return outcome;
}

/** A voluntary return the store approved: how to send the goods back. Once. */
export const sendReturnApproved = (storeId: string, returnId: string) =>
  returnMail(storeId, returnId, "approved", "return.approved", (mail, text) => ({
    subject: text.returns.approvedSubject(mail.ctx.store.name, mail.ret.number),
    heading: text.returns.approvedHeading,
    intro: text.returns.approvedIntro(mail.ret.number),
    blocks: [{ type: "paragraph", text: joinLines(mail) }, whoPays(text, mail), ...instructionBlocks(text, mail)],
  }));

/** A voluntary return the store declined, with its reason; the shopper's other rights are said to be unaffected. Once. */
export const sendReturnDeclined = (storeId: string, returnId: string) =>
  returnMail(storeId, returnId, "declined", "return.declined", (mail, text) => ({
    subject: text.returns.declinedSubject(mail.ctx.store.name, mail.ret.number),
    heading: text.returns.declinedHeading,
    intro: text.returns.declinedIntro(mail.ret.number),
    blocks: [
      ...(mail.ret.decisionNote ? [{ type: "paragraph" as const, text: text.returns.declinedReason(mail.ret.decisionNote) }] : []),
      { type: "paragraph", text: text.returns.declinedRights },
    ],
  }));

/** The goods have arrived. Once. */
export const sendReturnReceived = (storeId: string, returnId: string) =>
  returnMail(storeId, returnId, "received", "return.received", (mail, text) => ({
    subject: text.returns.receivedSubject(mail.ctx.store.name, mail.ret.number),
    heading: text.returns.receivedHeading,
    intro: text.returns.receivedIntro(mail.ret.number),
    blocks: [{ type: "paragraph", text: text.returns.receivedNext }],
  }));

/**
 * The refund: the amount with its working, always. What was taken off is said with its reason: each deduction for reduced value
 * with the note the store wrote when it inspected the goods (CRD Art. 14(2)), and an amount the store set itself as an adjustment
 * row and its reason, so a shopper never gets an amount without knowing how it was made. The order's own refund email is not sent
 * as well, so the shopper gets one. Once.
 */
export const sendReturnRefunded = (storeId: string, returnId: string, working: WorkingRow[] = []) =>
  returnMail(storeId, returnId, "refunded", "return.refunded", (mail, text, money) => {
    const amount = mail.ret.refundMinor ?? 0;
    const sum = working.reduce((total, row) => total + row.amountMinor, 0);
    const label: Record<WorkingRow["key"], string> = {
      goods: text.returns.rowGoods,
      deductions: text.returns.rowDeductions,
      shipping: text.returns.rowShipping,
      return_shipping: text.returns.rowReturnShipping,
    };
    const signed = (minor: number) => (minor < 0 ? `−${money(-minor)}` : money(minor));
    // One row of goods with nothing taken off or added is just the total.
    const showWorking = working.length > 1 || (working.length === 1 && sum !== amount);
    const rows = showWorking ? working.map((row) => ({ label: label[row.key], value: signed(row.amountMinor), muted: true })) : [];
    // An amount the store set itself differs from the working: the difference is a row of its own, so the rows add up.
    if (showWorking && sum !== amount) rows.push({ label: text.returns.rowAdjustment, value: signed(amount - sum), muted: true });
    const deductionNotes = mail.lines
      .filter((line) => line.decision === "accept" && line.deductionMinor > 0)
      .map((line) => text.returns.deductionNote(line.title, line.deductionNote ?? ""));
    const reasons = [...deductionNotes, ...(mail.ret.refundNote ? [text.returns.refundedNote(mail.ret.refundNote)] : [])];
    return {
      subject: text.returns.refundedSubject(mail.ctx.store.name, mail.ret.number),
      heading: text.returns.refundedHeading,
      intro: text.returns.refundedIntro(money(amount), mail.ret.number),
      blocks: [
        { type: "lines", rows: [...rows, { label: text.returns.rowTotal, value: money(amount), strong: true }] },
        ...(reasons.length > 0 ? [{ type: "paragraph" as const, text: reasons.join("\n") }] : []),
        { type: "paragraph", text: text.returns.refundedTiming },
      ],
    };
  }, true);

/**
 * The reminder to the store that a withdrawal's refund is past its legal deadline: to the store's contact email, in
 * English (the admin is English only), once per return.
 */
export async function sendRefundOverdueReminder(storeId: string, returnId: string): Promise<SendOutcome | null> {
  const mail = await loadMail(storeId, returnId);
  const to = mail?.facts.contactEmail;
  if (!mail || !to || !mail.ret.refundDeadline) return null;
  const text = emailText("en");
  const store = mail.ctx.store;
  const date = formatStoreDay(dayIn(mail.ret.refundDeadline, mail.facts.timeZone), "en-GB");
  const email = renderEmail({
    subject: text.returns.overdueSubject(store.name, mail.ret.number),
    preview: text.returns.overdueIntro(mail.ret.number, date),
    lang: "en",
    footer: emailFooter(store, text),
    blocks: [
      { type: "heading", text: text.returns.overdueHeading },
      { type: "paragraph", text: text.returns.overdueIntro(mail.ret.number, date) },
      { type: "button", text: text.returns.overdueOpen, url: `${siteUrl()}/admin/${store.slug}/returns/${returnId}` },
    ],
  });
  return sendEmail({
    storeId,
    kind: "return.overdue",
    to,
    email,
    fromName: store.name,
    idempotencyKey: `return.${returnId}.overdue`,
    orderId: mail.facts.orderId,
  });
}
