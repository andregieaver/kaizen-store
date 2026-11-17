import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { checkMessage, checkSignup, looksAutomated, returnPath, type Answer, type FormResponse } from "@/lib/forms";
import { type FormRequest } from "@/lib/forms-schema";
import { t, type Messages } from "@/lib/i18n";
import { pageBlockSchema, withChildren, type EmailFormBlock, type NewsletterBlock, type PageContent } from "@/lib/page-content";
import { storeSiteUrl } from "@/lib/paths";
import { siteUrl } from "@/lib/site";

import { sendEmail, type SendOutcome } from "./email";
import { recordFormSent } from "./experiments";
import { issueSignupCode } from "./discounts";
import { houseStoreId } from "./house-customers";
import { log } from "./log";
import { joinList } from "./marketing-subscribers";
import { tagFromForm } from "./segments";
import { storeById, type EmailStore } from "./shopper-emails";
import { formToInbox } from "./support-forms";
import { formIsPublished, getForm, keepResponse } from "./forms-admin";
import { formAsBlock, formTakesAnswers, type FormInbox as FormInboxChoice } from "@/lib/form-records";
import { todayInZone } from "@/lib/questions";
import { owned } from "./owned";

type Row = Record<string, unknown>;

/**
 * Forms on pages (D93): a visitor's message, or newsletter sign-up, emailed
 * to the addresses the form's owner chose. The form is found by its id in
 * the owner's published pages, so only what the site shows can send, and
 * only to its own recipients; visitors never choose where it goes, and
 * are never sent a copy (which would let anyone send email through the
 * site). A sign-up is confirmed by the visitor first unless the owner
 * switched that off.
 */

/** Sends a visitor may make to one site in an hour, and a form in a day. */
export const VISITOR_HOURLY = 5;
export const FORM_DAILY = 200;
/** A confirmation link works this long. */
const CONFIRM_DAYS = 7;

type FormOwner = { storeId: string | null; store: EmailStore | null; name: string; origin: string; lang: string; timeZone: string };
/** A form found: a page's own email form or sign-up (D93), or a form record (D705) as one, with its id in `formId` (its responses are kept). */
type FoundForm = { block: EmailFormBlock | NewsletterBlock; pageTitle: string; owner: FormOwner; formId: string | null; inbox?: FormInboxChoice };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id `commerce.lifted_form_id()` gave a page's own form when it became a form of its owner (D705 F2): md5 of the owner and the component's
 * id, shaped as `clone_id()` shapes its ids (version 4, variant 8).
 */
export function liftedFormId(storeId: string | null, blockId: string): string {
  const md5 = createHash("md5").update(`${storeId ?? "platform"}:${blockId}`).digest("hex");
  const h = `${md5.slice(0, 12)}4${md5.slice(13, 16)}8${md5.slice(17, 32)}`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A daily hash of the visitor's address: enough to count their sends, not to know them. */
export function formVisitor(address: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${address}|${day}|kaizen-forms`).digest("hex").slice(0, 32);
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

async function formOwner(storeId: string | null): Promise<FormOwner | null> {
  if (!storeId) return { storeId: null, store: null, name: "Kaizena Flow", origin: siteUrl(), lang: "en", timeZone: "UTC" };
  const [store, [zone]] = await Promise.all([
    storeById(storeId),
    db().execute<Row>(sql`select time_zone from commerce.stores where id = ${storeId}::uuid`),
  ]);
  if (!store) return null;
  return {
    storeId,
    store,
    name: store.name,
    origin: storeSiteUrl(store.slug),
    lang: store.markets[0]?.lang ?? "en",
    timeZone: zone?.time_zone ? String(zone.time_zone) : "UTC",
  };
}

/** The form with this id on one of the owner's published pages (headers and footers too), as published. */
export async function findForm(storeId: string | null, blockId: string): Promise<FoundForm | null> {
  // A form record (D705), placed by a page's `form` component: active, able to deliver, and on one of the owner's published pages.
  const saved = async (id: string): Promise<FoundForm | null | undefined> => {
    const form = await getForm(storeId, id);
    if (!form) return undefined;
    if (!formTakesAnswers(form) || !(await formIsPublished(storeId, form.id))) return null;
    const owner = await formOwner(storeId);
    // The questions in the owner's main words: the answers are labelled in them, as a page's own form labels them (D93).
    return owner && { block: formAsBlock(form, null), pageTitle: form.name, owner, formId: form.id, inbox: form.delivery.inbox };
  };
  if (UUID.test(blockId)) {
    const found = await saved(blockId);
    if (found !== undefined) return found;
  }
  const rows = await db().execute<Row>(sql`
    select published from commerce.pages
    where ${owned(storeId)} and published is not null
      and (jsonb_path_exists(published, '$.rows[*].columns[*].blocks[*] ? (@.id == $id)', jsonb_build_object('id', ${blockId}::text))
        -- In a Columns component's column (D294).
        or jsonb_path_exists(published, '$.rows[*].columns[*].blocks[*].columns[*].blocks[*] ? (@.id == $id)', jsonb_build_object('id', ${blockId}::text)))
    order by published_at desc nulls last
    limit 1
  `);
  const page = rows[0]?.published as PageContent | undefined;
  const raw = page?.rows?.flatMap((row) => row.columns.flatMap((column) => withChildren(column.blocks))).find((block) => block.id === blockId);
  const parsed = raw ? pageBlockSchema.safeParse(raw) : null;
  const block = parsed?.success ? parsed.data : null;
  // A page's own form moved into a form of its owner (D705 F2, `lift_page_forms()`): sent from a page drawn before the move, or confirmed
  // from a link emailed before it, it is found by the id the move gave it.
  if (!block) return (await saved(liftedFormId(storeId, blockId))) ?? null;
  if (block.type === "form") return block.formId ? ((await saved(block.formId)) ?? null) : null;
  if ((block.type !== "emailForm" && block.type !== "newsletter") || block.recipients.length === 0) return null;
  const owner = await formOwner(storeId);
  return owner && { block, pageTitle: page!.title, owner, formId: null };
}

/** Whether the visitor, or the form, has sent all they may for now. */
async function overLimit(storeId: string | null, blockId: string, visitor: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select
      count(*) filter (where visitor = ${visitor} and created_at > now() - interval '1 hour')::int as visitor,
      count(*) filter (where block_id = ${blockId} and created_at > now() - interval '1 day')::int as form
    from commerce.form_submissions
    where ${owned(storeId)} and created_at > now() - interval '1 day'
      and (visitor = ${visitor} or block_id = ${blockId})
  `);
  return Number(row.visitor) >= VISITOR_HOURLY || Number(row.form) >= FORM_DAILY;
}

/** The worst of several sends: one failure fails them all, as the owner then misses something. */
const worst = (outcomes: SendOutcome[]): "sent" | "logged" | "failed" =>
  outcomes.includes("failed") ? "failed" : outcomes.every((o) => o === "sent" || o === "duplicate") ? "sent" : "logged";

function ownerFooter(owner: FormOwner): string[] {
  if (!owner.store) return ["Kaizena Flow"];
  const d = owner.store.details;
  return [[d.legalName ?? owner.name, d.organisationNumber && `Org.nr. ${d.organisationNumber}`].filter(Boolean).join(" · "), d.postalAddress?.replace(/\n/g, ", ") ?? ""].filter(
    Boolean,
  );
}

/** One email to each of the form's recipients, in the owner's language. */
async function relay(
  found: FoundForm,
  kind: "form.message" | "form.subscription",
  content: { subject: string; heading: string; intro: string; blocks: EmailBlock[] },
  replyTo: string | null,
  key: string,
): Promise<"sent" | "logged" | "failed"> {
  const { owner, block } = found;
  const email = renderEmail({
    subject: content.subject,
    preview: content.intro,
    blocks: [{ type: "heading", text: content.heading }, { type: "paragraph", text: content.intro }, ...content.blocks],
    footer: ownerFooter(owner),
    lang: owner.lang,
  });
  const outcomes = await Promise.all(
    block.recipients.map((to) =>
      sendEmail({ storeId: owner.storeId, kind, to, email, fromName: owner.name, replyTo, idempotencyKey: `${key}:${to}` }),
    ),
  );
  return worst(outcomes);
}

/** Each answer as its question over what was written. */
const answerBlocks = (answers: Answer[]): EmailBlock[] => answers.map((answer) => ({ type: "paragraph", text: `${answer.label}:\n${answer.value}` }));

const pageLine = (m: Messages, owner: FormOwner, path: string): EmailBlock => ({ type: "paragraph", text: `${m.form.page}: ${owner.origin}${path}` });

/** A visitor's message or sign-up: checked, counted, and emailed (or, for a sign-up, sent for the visitor to confirm). */
export async function submitForm(request: FormRequest, visitor: string): Promise<{ status: number; body: FormResponse }> {
  const v = t(request.lang);
  const found = await findForm(request.store, request.block);
  if (!found) return { status: 404, body: { ok: false, error: v.form.failed } };
  const { block, owner } = found;
  const o = t(owner.lang);

  if (block.type === "emailForm") {
    // A date's earliest and latest day count from the owner's today (D705 F3); a hidden field reads the address it was sent on (D738).
    const checked = checkMessage(block, request.values, request.consent, v, o, todayInZone(owner.timeZone), request.path);
    if (!checked.ok) return { status: 422, body: { ok: false, errors: checked.errors } };
    // A robot is told it worked, and nothing is sent.
    if (looksAutomated(request)) return { status: 200, body: { ok: true, outcome: "sent" } };
    if (await overLimit(owner.storeId, block.id, visitor)) return { status: 429, body: { ok: false, error: v.form.busy } };
    const [row] = await db().execute<Row>(sql`
      insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, path, locale)
      values (${owner.storeId}::uuid, ${block.id}, 'message', ${visitor}, 'pending', ${request.path}, ${request.lang})
      returning id
    `);
    // A test of this form counts it once the site has accepted the answer (D148, phase 11).
    if (owner.storeId) await recordFormSent(owner.storeId, block.id);
    const answers = [...checked.answers, ...(block.consent ? [{ label: o.form.consent, value: `${block.consent} (${o.form.yes})` }] : [])];
    const subject = block.subject || o.form.messageSubject(owner.name);
    // A store's message goes to its support inbox while the desk is on (D382), and its recipients are emailed too unless the owner chose the inbox alone.
    const nameField = block.fields.find((f) => f.kind === "name");
    const typedName = nameField ? request.values[nameField.id] : undefined;
    const inbox = await formToInbox(
      owner.storeId,
      { blockId: block.id, subject, path: request.path, lang: request.lang, inbox: found.inbox },
      answers,
      { email: checked.replyTo, name: typeof typedName === "string" ? typedName : null },
    );
    const keep = (delivery: "sent" | "logged" | "failed" | "inbox") =>
      found.formId ? keepResponse({ formId: found.formId, answers, contactEmail: checked.replyTo, path: request.path, locale: request.lang, delivery }) : Promise.resolve();
    if (inbox.kept && !inbox.emailToo) {
      await db().execute(sql`update commerce.form_submissions set status = 'sent' where id = ${String(row.id)}::uuid and ${owned(owner.storeId)}`);
      await keep("inbox");
      return { status: 200, body: { ok: true, outcome: "sent" } };
    }
    const status = await relay(
      found,
      "form.message",
      {
        subject,
        heading: o.form.messageHeading,
        intro: checked.replyTo ? o.form.replyHint : "",
        blocks: [{ type: "divider" }, ...answerBlocks(answers), { type: "divider" }, pageLine(o, owner, request.path)],
      },
      checked.replyTo,
      `form:${String(row.id)}`,
    );
    await db().execute(sql`update commerce.form_submissions set status = ${status} where id = ${String(row.id)}::uuid and ${owned(owner.storeId)}`);
    // Kept even when the email failed: the owner finds it under the form's responses (D705).
    await keep(status);
    return status === "failed" ? { status: 502, body: { ok: false, error: v.form.failed } } : { status: 200, body: { ok: true, outcome: "sent" } };
  }

  const checked = checkSignup(block, request.values, request.consent, v);
  if (!checked.ok) return { status: 422, body: { ok: false, errors: checked.errors } };
  const confirm = block.confirm !== false;
  const done: FormResponse = { ok: true, outcome: confirm ? "confirm" : "sent" };
  if (looksAutomated(request)) return { status: 200, body: done };
  if (await overLimit(owner.storeId, block.id, visitor)) return { status: 429, body: { ok: false, error: v.form.busy } };
  // The same address signed up to the same form today is not sent again.
  const [again] = await db().execute<Row>(sql`
    select 1 from commerce.form_submissions
    where ${owned(owner.storeId)} and block_id = ${block.id} and email = ${checked.email}
      and created_at > now() - interval '1 day'
    limit 1
  `);
  if (again) return { status: 200, body: done };

  const consent = block.consent || v.form.newsletterConsent;
  const payload = { name: checked.name, consent, consentedAt: new Date().toISOString() };
  const token = randomBytes(32).toString("base64url");
  const [row] = await db().execute<Row>(sql`
    insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, email, token_hash, payload, path, locale)
    values (
      ${owner.storeId}::uuid, ${block.id}, 'subscription', ${visitor}, 'pending', ${checked.email},
      ${confirm ? hash(token) : null}, ${confirm ? JSON.stringify(payload) : null}::jsonb, ${request.path}, ${request.lang}
    )
    returning id
  `);
  const id = String(row.id);
  if (owner.storeId) await recordFormSent(owner.storeId, block.id);
  if (!confirm) {
    // A store's form keeps the person on its list (D295), as unconfirmed: the owner switched the confirmation off. Kaizena Flow's own forms keep
    // them on its own store's list (D467).
    const list = owner.storeId ?? (await houseStoreId());
    if (list) await keepOnList(list, block.id, checked.email, payload, request.lang, "unconfirmed");
    const status = await relaySignup(found, checked.email, payload, null, request.path, id);
    await db().execute(sql`update commerce.form_submissions set status = ${status} where id = ${id}::uuid and ${owned(owner.storeId)}`);
    if (found.formId) {
      await keepResponse({ formId: found.formId, answers: signupAnswers(found, checked.email, payload, null), contactEmail: checked.email, path: request.path, locale: request.lang, delivery: status });
    }
    return status === "failed" ? { status: 502, body: { ok: false, error: v.form.failed } } : { status: 200, body: done };
  }

  // The confirmation goes to the visitor, from the site, in their language; its link is on the site's own address.
  const link = `${owner.origin}/api/forms/confirm?t=${token}`;
  const email = renderEmail({
    subject: v.form.confirmSubject(owner.name),
    preview: v.form.confirmHeading,
    blocks: [
      { type: "heading", text: v.form.confirmHeading },
      { type: "paragraph", text: v.form.confirmText(owner.name) },
      { type: "button", text: v.form.confirmButton, url: link },
      { type: "paragraph", text: v.form.confirmValid },
    ],
    footer: [...ownerFooter(owner), ...(owner.store?.details.contactEmail ? [emailText(request.lang).questions(owner.store.details.contactEmail)] : [])],
    lang: request.lang,
  });
  const sent = await sendEmail({
    storeId: owner.storeId,
    kind: "form.confirm",
    to: checked.email,
    email,
    fromName: owner.name,
    replyTo: owner.store?.details.contactEmail ?? null,
    idempotencyKey: `form-confirm:${id}`,
  });
  return sent === "failed" ? { status: 502, body: { ok: false, error: v.form.failed } } : { status: 200, body: done };
}

type SignupPayload = { name: string; consent: string; consentedAt: string };

/**
 * A newsletter sign-up on a subscriber list (D295), with the words agreed to and when: a store's form on the store's list, Kaizena Flow's own
 * forms on the list of Kaizena Flow's own store (D467), where its broadcasts and automations reach the people who asked.
 */
async function keepOnList(storeId: string, blockId: string, email: string, payload: SignupPayload, locale: string, proof: "confirmed" | "unconfirmed") {
  try {
    await joinList({
      storeId,
      email,
      name: payload.name,
      locale,
      marketCode: null,
      source: "form",
      sourceRef: blockId,
      consentText: payload.consent.slice(0, 1000),
      consentedAt: new Date(payload.consentedAt),
      proof,
    });
  } catch (error) {
    // The owner's email still goes (it carries the same consent), and the person is told it worked; the list misses them, which the log says.
    log("error", "forms.subscriber_keep_failed", {}, error);
  }
}

/**
 * What a store's form gives an address once it confirmed (D304 J3): its tags, and one code of its discount emailed to the address it confirmed.
 * Never fails the confirmation: a problem is logged.
 */
async function welcomeSignup(found: FoundForm, email: string, lang: string, id: string) {
  const { owner, block } = found;
  if (!owner.storeId || block.type !== "newsletter") return;
  try {
    if (block.tags?.length) await tagFromForm(owner.storeId, email, block.tags);
    if (!block.incentive) return;
    const code = await issueSignupCode(owner.storeId, block.incentive, email, block.id);
    if (!code) return;
    const n = t(lang).news;
    const message = renderEmail({
      subject: n.welcomeSubject(owner.name),
      preview: n.welcomeHeading,
      blocks: [
        { type: "heading", text: n.welcomeHeading },
        { type: "paragraph", text: n.welcomeText(owner.name) },
        { type: "heading", text: code },
        { type: "button", text: n.welcomeShop, url: owner.origin },
      ],
      footer: [...ownerFooter(owner), n.emailReason(owner.name)],
      lang,
    });
    await sendEmail({
      storeId: owner.storeId,
      kind: "form.welcome_code",
      to: email,
      email: message,
      fromName: owner.name,
      replyTo: owner.store?.details.contactEmail ?? null,
      idempotencyKey: `form-welcome:${id}`,
      secrets: [code],
    });
  } catch (error) {
    log("error", "forms.welcome_failed", {}, error);
  }
}

/** A sign-up as answers in the owner's language: who, the words they agreed to, and when. */
function signupAnswers(found: FoundForm, email: string, payload: SignupPayload, confirmedAt: Date | null): Answer[] {
  const { owner } = found;
  const o = t(owner.lang);
  const when = (iso: string | Date) =>
    `${new Intl.DateTimeFormat(owner.lang, { dateStyle: "long", timeStyle: "short", timeZone: owner.timeZone }).format(new Date(iso))} (${owner.timeZone})`;
  return [
    { label: o.form.email, value: email },
    ...(payload.name ? [{ label: o.form.name, value: payload.name }] : []),
    { label: o.form.consent, value: payload.consent },
    { label: o.form.consentedAt, value: when(payload.consentedAt) },
    ...(confirmedAt ? [{ label: o.form.confirmedAt, value: when(confirmedAt) }] : []),
  ];
}

/** The sign-up emailed to the recipients: who, the words they agreed to, and when. */
function relaySignup(found: FoundForm, email: string, payload: SignupPayload, confirmedAt: Date | null, path: string, id: string) {
  const { owner } = found;
  const o = t(owner.lang);
  const answers = signupAnswers(found, email, payload, confirmedAt);
  return relay(
    found,
    "form.subscription",
    {
      subject: o.form.subscriberSubject(owner.name),
      heading: o.form.subscriberHeading,
      intro: o.form.subscriberText,
      blocks: [{ type: "divider" }, ...answerBlocks(answers), { type: "divider" }, pageLine(o, owner, path)],
    },
    email,
    `form:${id}`,
  );
}

/**
 * A visitor opening their confirmation link: the sign-up is emailed to the
 * form's recipients once, and the visitor returns to the page, told how it
 * went. A link used, expired or unknown returns them there too, if known.
 */
export async function confirmSignup(token: string): Promise<{ location: string }> {
  const fallback = { location: `${siteUrl()}/` };
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return fallback;
  const [row] = await db().execute<Row>(sql`
    update commerce.form_submissions set token_hash = null, confirmed_at = now()
    where token_hash = ${hash(token)} and status = 'pending'
    returning id, store_id, block_id, email, payload, path, locale, confirmed_at, created_at > now() - make_interval(days => ${CONFIRM_DAYS}) as fresh
  `);
  if (!row) return fallback;
  const storeId = row.store_id ? String(row.store_id) : null;
  const blockId = String(row.block_id);
  const path = String(row.path);
  const found = await findForm(storeId, blockId);
  const origin = found?.owner.origin ?? (await formOwner(storeId))?.origin ?? siteUrl();
  const back = (result: "confirmed" | "expired") => ({ location: `${origin}${returnPath(path, blockId, result)}` });
  if (!row.fresh || !found || !row.payload) {
    await db().execute(sql`update commerce.form_submissions set status = 'expired', payload = null where id = ${String(row.id)}::uuid and ${owned(storeId)}`);
    return back("expired");
  }
  const list = storeId ?? (await houseStoreId());
  if (list) await keepOnList(list, blockId, String(row.email), row.payload as SignupPayload, String(row.locale), "confirmed");
  if (storeId && found.block.type === "newsletter") await welcomeSignup(found, String(row.email), String(row.locale), String(row.id));
  const confirmedAt = new Date(String(row.confirmed_at));
  const status = await relaySignup(found, String(row.email), row.payload as SignupPayload, confirmedAt, path, String(row.id));
  await db().execute(sql`update commerce.form_submissions set status = ${status}, payload = null where id = ${String(row.id)}::uuid and ${owned(storeId)}`);
  if (found.formId) {
    const answers = signupAnswers(found, String(row.email), row.payload as SignupPayload, confirmedAt);
    await keepResponse({ formId: found.formId, answers, contactEmail: String(row.email), path, locale: String(row.locale), delivery: status });
  }
  return back("confirmed");
}

/** Forgets sends older than 30 days (the daily run, so a send is kept 30 to 31 days). */
export async function pruneFormSubmissions(): Promise<number> {
  const rows = await db().execute<Row>(sql`delete from commerce.form_submissions where created_at < now() - interval '30 days' returning 1`);
  return rows.length;
}
