import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { ContractSnapshot } from "@/lib/contract-fields";
import { maskEmail, signingText } from "@/lib/contract-signing-text";
import { renderEmail, type EmailBlock } from "@/lib/email-layout";
import { marketUrl } from "@/lib/paths";
import { siteUrl } from "@/lib/site";

import { audit, type Membership } from "./auth";
import { sendContract, type SendDeps, type SendResult } from "./contracts";
import { sendEmail, type OutgoingEmail, type SendOutcome } from "./email";
import { documentStorage, type DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { memberCan } from "./permissions";
import { emailContext, emailFooter, storeById } from "./shopper-emails";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Signing a contract on our own page (D695 step 3, `docs/contracts.md` 5). Sending asks the first signer: the store's signer is told in the
 * admin (and by email when someone else sent it), the customer's by an email with their own link (`/s/{store}/{market}/account/sign/{token}`).
 * A signer on the page proves their email with a six-digit code (kept as a hash, ten minutes, five tries, at most five an hour), types
 * their name and agrees; the store's signer signs inside the admin, signed in as themselves (with two-step where the store asks it). Each signature is
 * against the SHA-256 of the PDF that was sent, which the database checks; the database also signs the contract when the last signer has,
 * wins its deal and declines it on one decline. Then the next signer is asked; the signed PDF is made by the job
 * (`contract-signed-pdf.ts`). Every email is in the contract's language; a code is never kept in the email log.
 */

const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_HOUR = 5;
const TOKEN = /^sig_[A-Za-z0-9_-]{43}$/;

export type Request = { ip: string | null; userAgent: string | null };
export type Mailer = (message: OutgoingEmail) => Promise<SendOutcome>;
export type SigningDeps = { mail?: Mailer; now?: Date; code?: () => string };

const clip = (value: string | null, max: number) => (value ? value.slice(0, max) : null);
const hashCode = (signerId: string, code: string) => createHash("sha256").update(`${signerId}:${code}`).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const localeOf = (language: string) => (language === "nb" ? "nb-NO" : "en-GB");

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading a signer by their link
// ---------------------------------------------------------------------------------------------------------------------------------

const signerRow = z.object({
  signer_id: col.uuid,
  store_id: col.uuid,
  contract_id: col.uuid,
  role: z.enum(["store", "customer", "other"]),
  position: col.int,
  name: col.text,
  email: col.text,
  viewed_at: col.timestampOrNull,
  signed_at: col.timestampOrNull,
  declined_at: col.timestampOrNull,
  title: col.text,
  language: col.text,
  status: z.enum(["draft", "sent", "signed", "declined", "expired", "cancelled"]),
  snapshot: z.unknown().nullable(),
  pdf_sha256: col.textOrNull,
  expires_at: col.timestampOrNull,
  earlier_unsigned: col.int,
});

export type SignerView = {
  signerId: string;
  storeId: string;
  contractId: string;
  role: "store" | "customer" | "other";
  name: string;
  emailMasked: string;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  title: string;
  language: string;
  status: "draft" | "sent" | "signed" | "declined" | "expired" | "cancelled";
  snapshot: ContractSnapshot | null;
  expiresAt: string | null;
  /** Every signer before this one has signed. */
  turn: boolean;
  /** Open for this signer to sign now: sent, before its expiry, their turn, not signed or declined. */
  open: boolean;
};

async function readSigner(where: ReturnType<typeof sql>, now: Date): Promise<SignerView | null> {
  const r = await typedRow(
    signerRow,
    sql`
      select g.id as signer_id, g.store_id, g.contract_id, g.role, g.position, g.name, g.email, g.viewed_at, g.signed_at, g.declined_at,
        c.title, c.language, c.status, c.snapshot, c.pdf_sha256, c.expires_at,
        (select count(*)::int from commerce.contract_signers e
          where e.store_id = g.store_id and e.contract_id = g.contract_id and e.position < g.position and e.signed_at is null) as earlier_unsigned
      from commerce.contract_signers g
      join commerce.contracts c on c.store_id = g.store_id and c.id = g.contract_id
      where ${where}
    `,
  );
  if (!r) return null;
  const turn = r.earlier_unsigned === 0;
  const open = r.status === "sent" && turn && !r.signed_at && !r.declined_at && r.expires_at !== null && new Date(r.expires_at) > now;
  return {
    signerId: r.signer_id,
    storeId: r.store_id,
    contractId: r.contract_id,
    role: r.role,
    name: r.name,
    emailMasked: maskEmail(r.email),
    viewedAt: r.viewed_at,
    signedAt: r.signed_at,
    declinedAt: r.declined_at,
    title: r.title,
    language: r.language,
    status: r.status,
    snapshot: (r.snapshot as ContractSnapshot | null) ?? null,
    expiresAt: r.expires_at,
    turn,
    open,
  };
}

/** The signer a link names, with their contract, or null for a link that is not one (a draft's signer has no page). */
export async function signerByToken(token: string, now: Date = new Date()): Promise<SignerView | null> {
  if (!TOKEN.test(token)) return null;
  const view = await readSigner(sql`g.token = ${token}`, now);
  return view && view.status !== "draft" ? view : null;
}

/** The first time a signer opens their page: kept once, with an event. */
export async function markViewed(token: string, request: Request): Promise<void> {
  if (!TOKEN.test(token)) return;
  const seen = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, contract_id: col.uuid }),
    sql`
      update commerce.contract_signers g set viewed_at = now()
      from commerce.contracts c
      where g.token = ${token} and g.viewed_at is null and c.store_id = g.store_id and c.id = g.contract_id and c.status = 'sent'
      returning g.id, g.store_id, g.contract_id
    `,
  );
  for (const s of seen) {
    await db().execute(sql`
      insert into commerce.contract_events (store_id, contract_id, signer_id, kind, ip, user_agent)
      values (${s.store_id}::uuid, ${s.contract_id}::uuid, ${s.id}::uuid, 'viewed', ${clip(request.ip, 64)}, ${clip(request.userAgent, 500)})
    `);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------------------------------------------------------------

const contactRow = z.object({
  store_id: col.uuid,
  contract_id: col.uuid,
  deal_id: col.uuid.nullable(),
  signer_id: col.uuid,
  role: z.enum(["store", "customer", "other"]),
  name: col.text,
  email: col.text,
  token: col.text,
  account_id: col.uuid.nullable(),
  title: col.text,
  language: col.text,
  expires_at: col.timestampOrNull,
});

/** What an email to a signer needs: the store, its home market, the words and the footer, in the contract's language. */
async function mailContext(storeId: string, language: string) {
  const store = await storeById(storeId);
  const home = store?.markets[0];
  if (!store || !home) return null;
  const ctx = await emailContext(storeId, home.code, localeOf(language));
  if (!ctx) return null;
  return { ...ctx, home, words: signingText(language) };
}

/** The link a customer's signer signs on: on the store's own site, at its home market. */
const signUrl = (storeSlug: string, marketSlug: string, token: string) => marketUrl(storeSlug, marketSlug, `/account/sign/${token}`);

/** The contract's page in the admin, for the store's signer and staff. */
const adminContractUrl = (storeSlug: string, dealId: string | null, contractId: string) =>
  dealId ? `${siteUrl()}/admin/${storeSlug}/deals/${dealId}/contracts/${contractId}` : `${siteUrl()}/admin/${storeSlug}/deals`;

const dayIn = (iso: string, locale: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Oslo" });

/**
 * Asks the next signer who has not been asked, if it is their turn: the customer's by an email with their link, the store's by an email to
 * the admin unless they are the one who just acted (`skipAccount`, who is on the page already). Marks them asked. Never throws: a failed
 * email is logged, and the reminder job asks again.
 */
export async function notifyNext(storeId: string, contractId: string, options: SigningDeps & { skipAccount?: string | null; reminder?: boolean } = {}): Promise<void> {
  try {
    const next = await typedRow(
      contactRow,
      sql`
        select g.store_id, g.contract_id, c.deal_id, g.id as signer_id, g.role, g.name, g.email, g.token, g.account_id, c.title, c.language, c.expires_at
        from commerce.contract_signers g join commerce.contracts c on c.store_id = g.store_id and c.id = g.contract_id
        where g.store_id = ${storeId}::uuid and g.contract_id = ${contractId}::uuid and c.status = 'sent'
          and g.signed_at is null and g.declined_at is null
        order by g.position limit 1
      `,
    );
    if (!next || (!options.reminder && (await alreadyAsked(next.signer_id)))) return;
    const marked = async () =>
      db().execute(sql`
        update commerce.contract_signers set notified_at = now(), reminders = reminders + ${options.reminder ? 1 : 0}
        where store_id = ${storeId}::uuid and id = ${next.signer_id}::uuid
      `);
    if (next.role === "store" && next.account_id && next.account_id === options.skipAccount) {
      await marked();
      return;
    }
    const ctx = await mailContext(storeId, next.language);
    if (!ctx) return;
    const { store, home, words } = ctx;
    const locale = localeOf(next.language);
    const blocks: EmailBlock[] =
      next.role === "store"
        ? [
            { type: "heading", text: words.storeTurn.subject(next.title) },
            { type: "paragraph", text: words.storeTurn.intro(next.title) },
            { type: "button", text: words.storeTurn.button, url: adminContractUrl(store.slug, next.deal_id, contractId) },
          ]
        : [
            { type: "heading", text: words.toSign.heading },
            { type: "paragraph", text: options.reminder ? words.reminder.intro(store.name, next.title) : words.toSign.intro(store.name, next.title) },
            ...(next.expires_at ? [{ type: "paragraph" as const, text: words.toSign.until(dayIn(next.expires_at, locale)) }] : []),
            { type: "button", text: words.toSign.button, url: signUrl(store.slug, home.slug, next.token) },
            { type: "paragraph", text: words.toSign.notYou },
          ];
    const subject =
      next.role === "store" ? words.storeTurn.subject(next.title) : options.reminder ? words.reminder.subject(store.name) : words.toSign.subject(store.name);
    const email = renderEmail({ subject, preview: subject, blocks, footer: emailFooter(store, ctx.text), lang: next.language });
    const outcome = await (options.mail ?? sendEmail)({
      storeId,
      kind: next.role === "store" ? "contract.store_turn" : options.reminder ? "contract.reminder" : "contract.to_sign",
      to: next.email,
      email,
      fromName: store.name,
      replyTo: store.details.contactEmail,
      idempotencyKey: `contract-${options.reminder ? "reminder" : "ask"}:${next.signer_id}${options.reminder ? `:${Date.now()}` : ""}`,
      // The link is the signer's whole access: it is never kept in the log's copy.
      secrets: [next.token],
    });
    if (outcome === "sent" || outcome === "duplicate") {
      await marked();
      if (options.reminder) {
        await db().execute(sql`
          insert into commerce.contract_events (store_id, contract_id, signer_id, kind) values (${storeId}::uuid, ${contractId}::uuid, ${next.signer_id}::uuid, 'reminded')
        `);
      }
    }
  } catch (error) {
    log("error", "contracts.notify_failed", { contractId }, error);
  }
}

const alreadyAsked = async (signerId: string) =>
  Boolean(
    (await typedRow(z.object({ asked: col.bool }), sql`select notified_at is not null as asked from commerce.contract_signers where id = ${signerId}::uuid`))?.asked,
  );

// ---------------------------------------------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------------------------------------------

/** Sends a draft for signing (`customers:write`): frozen as `sendContract()` does, then its first signer is asked. */
export async function sendForSigning(member: Membership, contractId: string, deps: SendDeps & SigningDeps): Promise<SendResult> {
  const sent = await sendContract(member, contractId, deps);
  if (sent.ok) await notifyNext(member.store.id, contractId, { ...deps, skipAccount: member.account.id });
  return sent;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The code, signing and declining on the page
// ---------------------------------------------------------------------------------------------------------------------------------

export type CodeProblem = "not_found" | "closed" | "not_turn" | "expired" | "too_many";

const closedProblem = (view: SignerView, now: Date): "closed" | "not_turn" | "expired" | null =>
  view.status !== "sent" || view.signedAt || view.declinedAt
    ? "closed"
    : view.expiresAt && new Date(view.expiresAt) <= now
      ? "expired"
      : view.turn
        ? null
        : "not_turn";

/** A new code to the signer's email (at most five an hour); the email holds the code, the log never does. */
export async function requestCode(token: string, request: Request, deps: SigningDeps = {}): Promise<{ ok: true } | { ok: false; problem: CodeProblem }> {
  const now = deps.now ?? new Date();
  const view = await signerByToken(token, now);
  if (!view || view.role === "store") return { ok: false, problem: "not_found" };
  const shut = closedProblem(view, now);
  if (shut) return { ok: false, problem: shut };
  const recent = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.contract_codes where signer_id = ${view.signerId}::uuid and created_at > ${now.toISOString()}::timestamptz - interval '1 hour'`,
  );
  if ((recent?.n ?? 0) >= CODES_PER_HOUR) return { ok: false, problem: "too_many" };
  const code = deps.code ? deps.code() : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const contact = await typedRow(z.object({ email: col.text }), sql`select email from commerce.contract_signers where id = ${view.signerId}::uuid`);
  if (!contact) return { ok: false, problem: "not_found" };
  await db().execute(sql`
    insert into commerce.contract_codes (store_id, signer_id, code_hash, expires_at)
    values (${view.storeId}::uuid, ${view.signerId}::uuid, ${hashCode(view.signerId, code)}, ${now.toISOString()}::timestamptz + make_interval(mins => ${CODE_MINUTES}))
  `);
  await db().execute(sql`
    insert into commerce.contract_events (store_id, contract_id, signer_id, kind, ip, user_agent)
    values (${view.storeId}::uuid, ${view.contractId}::uuid, ${view.signerId}::uuid, 'code_sent', ${clip(request.ip, 64)}, ${clip(request.userAgent, 500)})
  `);
  const ctx = await mailContext(view.storeId, view.language);
  if (ctx) {
    const w = ctx.words.code;
    const email = renderEmail({
      subject: w.subject(ctx.store.name),
      preview: w.intro,
      blocks: [
        { type: "paragraph", text: w.intro },
        { type: "code", text: code },
        { type: "paragraph", text: w.minutes },
      ],
      footer: emailFooter(ctx.store, ctx.text),
      lang: view.language,
    });
    await (deps.mail ?? sendEmail)({
      storeId: view.storeId,
      kind: "contract.code",
      to: contact.email,
      email,
      fromName: ctx.store.name,
      replyTo: ctx.store.details.contactEmail,
      secrets: [code],
    });
  }
  return { ok: true };
}

export type SignProblem = CodeProblem | "code" | "code_expired" | "too_many_tries" | "name" | "agree";

const nameOk = (name: string) => {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed.length >= 2 && trimmed.length <= 200 ? trimmed : null;
};

/**
 * Signs with the newest code: five tries a code, ten minutes, used once. The name typed and the agreement are kept with the evidence (how
 * the email was proven, and when), against the SHA-256 of the PDF that was sent; then the next signer is asked.
 */
export async function signWithCode(
  token: string,
  input: { code: string; name: string; agree: boolean },
  request: Request,
  deps: SigningDeps = {},
): Promise<{ ok: true; completed: boolean } | { ok: false; problem: SignProblem }> {
  const now = deps.now ?? new Date();
  const view = await signerByToken(token, now);
  if (!view || view.role === "store") return { ok: false, problem: "not_found" };
  const shut = closedProblem(view, now);
  if (shut) return { ok: false, problem: shut };
  const name = nameOk(input.name);
  if (!name) return { ok: false, problem: "name" };
  if (!input.agree) return { ok: false, problem: "agree" };
  const code = await typedRow(
    z.object({ id: col.uuid, code_hash: col.text, attempts: col.int, expires_at: col.timestamp, created_at: col.timestamp }),
    sql`select id, code_hash, attempts, expires_at, created_at from commerce.contract_codes
        where signer_id = ${view.signerId}::uuid and used_at is null order by created_at desc limit 1`,
  );
  if (!code) return { ok: false, problem: "code_expired" };
  if (new Date(code.expires_at) <= now) return { ok: false, problem: "code_expired" };
  if (code.attempts >= CODE_TRIES) return { ok: false, problem: "too_many_tries" };
  const typed = input.code.replace(/\D/g, "");
  if (!sameHash(code.code_hash, hashCode(view.signerId, typed))) {
    await db().execute(sql`update commerce.contract_codes set attempts = attempts + 1 where store_id = ${view.storeId}::uuid and id = ${code.id}::uuid`);
    return { ok: false, problem: code.attempts + 1 >= CODE_TRIES ? "too_many_tries" : "code" };
  }
  const evidence = { method: "email_code", codeSentAt: code.created_at, checkedAt: now.toISOString(), agreed: true };
  const result = await db().transaction(async (tx) => {
    const used = await typedRows(
      z.object({ id: col.uuid }),
      sql`update commerce.contract_codes set used_at = now() where store_id = ${view.storeId}::uuid and id = ${code.id}::uuid and used_at is null returning id`,
      tx,
    );
    if (used.length === 0) return { ok: false as const, problem: "code_expired" as const };
    await tx.execute(sql`
      insert into commerce.contract_events (store_id, contract_id, signer_id, kind, ip, user_agent)
      values (${view.storeId}::uuid, ${view.contractId}::uuid, ${view.signerId}::uuid, 'code_checked', ${clip(request.ip, 64)}, ${clip(request.userAgent, 500)})
    `);
    await tx.execute(sql`
      update commerce.contract_signers g set signed_at = now(), signed_name = ${name}, document_sha256 = c.pdf_sha256,
        evidence = ${JSON.stringify(evidence)}::jsonb, ip = ${clip(request.ip, 64)}, user_agent = ${clip(request.userAgent, 500)}
      from commerce.contracts c
      where g.store_id = ${view.storeId}::uuid and g.id = ${view.signerId}::uuid and c.store_id = g.store_id and c.id = g.contract_id
    `);
    const done = await typedRow(z.object({ status: col.text }), sql`select status from commerce.contracts where id = ${view.contractId}::uuid`, tx);
    return { ok: true as const, completed: done?.status === "signed" };
  });
  if (result.ok && !result.completed) await notifyNext(view.storeId, view.contractId, deps);
  return result;
}

/** Declines (a reason of at most 500 characters, or none): the database declines the contract; its staff are told. */
export async function declineAsSigner(
  token: string,
  rawReason: string,
  request: Request,
  deps: SigningDeps = {},
): Promise<{ ok: true } | { ok: false; problem: CodeProblem | "reason" }> {
  const now = deps.now ?? new Date();
  const view = await signerByToken(token, now);
  if (!view || view.role === "store") return { ok: false, problem: "not_found" };
  const shut = closedProblem(view, now);
  if (shut) return { ok: false, problem: shut };
  const reason = rawReason.trim();
  if (reason.length > 500) return { ok: false, problem: "reason" };
  await db().execute(sql`
    update commerce.contract_signers set declined_at = now(), decline_reason = ${reason || null},
      ip = ${clip(request.ip, 64)}, user_agent = ${clip(request.userAgent, 500)}
    where store_id = ${view.storeId}::uuid and id = ${view.signerId}::uuid and signed_at is null and declined_at is null
  `);
  await tellDeclined(view.storeId, view.contractId, view.name, reason || null, deps);
  return { ok: true };
}

/** The store's signer and the one who sent it are told a contract was declined, with the reason. */
async function tellDeclined(storeId: string, contractId: string, who: string, reason: string | null, deps: SigningDeps) {
  try {
    const rows = await typedRows(
      z.object({ email: col.text, title: col.text, language: col.text, deal_id: col.uuid.nullable() }),
      sql`
        select distinct a.email, c.title, c.language, c.deal_id from commerce.contracts c
        join commerce.accounts a on a.id in (c.sent_by, (select g.account_id from commerce.contract_signers g where g.store_id = c.store_id and g.contract_id = c.id and g.role = 'store'))
        where c.store_id = ${storeId}::uuid and c.id = ${contractId}::uuid
      `,
    );
    if (rows.length === 0) return;
    const ctx = await mailContext(storeId, rows[0].language);
    if (!ctx) return;
    const w = ctx.words.declined;
    for (const r of rows) {
      const email = renderEmail({
        subject: w.subject(r.title),
        preview: w.intro(who, r.title),
        blocks: [
          { type: "paragraph", text: w.intro(who, r.title) },
          ...(reason ? [{ type: "paragraph" as const, text: w.reason(reason) }] : []),
          { type: "button", text: w.button, url: adminContractUrl(ctx.store.slug, r.deal_id, contractId) },
        ],
        footer: emailFooter(ctx.store, ctx.text),
        lang: r.language,
      });
      await (deps.mail ?? sendEmail)({ storeId, kind: "contract.declined", to: r.email, email, fromName: ctx.store.name, idempotencyKey: `contract-declined:${contractId}:${r.email}` });
    }
  } catch (error) {
    log("error", "contracts.declined_notice_failed", { contractId }, error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The store's signer, in the admin
// ---------------------------------------------------------------------------------------------------------------------------------

export type StoreSignProblem = "forbidden" | "not_found" | "not_yours" | "closed" | "not_turn" | "expired" | "name" | "agree";

/**
 * The store's signer signs inside the admin (`customers:write`, and they must be the named signer): their own signed-in session is the
 * proof (two-step where the store asks it), and the evidence says only that. Then the customer's signer is asked.
 */
export async function signAsStore(
  member: Membership,
  contractId: string,
  input: { name: string; agree: boolean },
  request: Request,
  deps: SigningDeps = {},
): Promise<{ ok: true; completed: boolean } | { ok: false; problem: StoreSignProblem }> {
  if (!memberCan(member, "customers:write")) return { ok: false, problem: "forbidden" };
  const now = deps.now ?? new Date();
  const view = await readSigner(sql`g.store_id = ${member.store.id}::uuid and g.contract_id = ${contractId}::uuid and g.role = 'store'`, now);
  if (!view) return { ok: false, problem: "not_found" };
  const owner = await typedRow(z.object({ account_id: col.uuid.nullable() }), sql`select account_id from commerce.contract_signers where id = ${view.signerId}::uuid`);
  if (owner?.account_id !== member.account.id) return { ok: false, problem: "not_yours" };
  const shut = closedProblem(view, now);
  if (shut) return { ok: false, problem: shut };
  const name = nameOk(input.name);
  if (!name) return { ok: false, problem: "name" };
  if (!input.agree) return { ok: false, problem: "agree" };
  const evidence = { method: "admin_session", accountId: member.account.id, checkedAt: now.toISOString(), agreed: true };
  await db().execute(sql`
    update commerce.contract_signers g set signed_at = now(), signed_name = ${name}, document_sha256 = c.pdf_sha256,
      evidence = ${JSON.stringify(evidence)}::jsonb, ip = ${clip(request.ip, 64)}, user_agent = ${clip(request.userAgent, 500)}
    from commerce.contracts c
    where g.store_id = ${member.store.id}::uuid and g.id = ${view.signerId}::uuid and g.signed_at is null and c.store_id = g.store_id and c.id = g.contract_id
  `);
  const done = await typedRow(z.object({ status: col.text }), sql`select status from commerce.contracts where store_id = ${member.store.id}::uuid and id = ${contractId}::uuid`);
  const completed = done?.status === "signed";
  await audit(member.account.id, member.store.id, "contract.signed_for_store", { contract: contractId }, { area: "customers" });
  if (!completed) await notifyNext(member.store.id, contractId, { ...deps, skipAccount: member.account.id });
  return { ok: true, completed };
}

/**
 * The PDF a signer's link opens: the signed one once it is made, else the one that was sent (the file they sign). Read from the private
 * `documents` bucket; null for a link that is not one, a draft's, or a file that cannot be read.
 */
export async function signerDocument(token: string, storage: Pick<DocumentStorage, "download"> | null = documentStorage()): Promise<{ bytes: Uint8Array; signed: boolean; title: string } | null> {
  if (!TOKEN.test(token) || !storage) return null;
  const row = await typedRow(
    z.object({ store_id: col.uuid, title: col.text, pdf_path: col.textOrNull, signed_pdf_path: col.textOrNull }),
    sql`select c.store_id, c.title, c.pdf_path, c.signed_pdf_path from commerce.contract_signers g
        join commerce.contracts c on c.store_id = g.store_id and c.id = g.contract_id
        where g.token = ${token} and c.status <> 'draft'`,
  );
  const path = row?.signed_pdf_path ?? row?.pdf_path;
  if (!row || !path || !path.startsWith(`${row.store_id}/contracts/`)) return null;
  const bytes = await storage.download(path).catch(() => null);
  return bytes ? { bytes, signed: path === row.signed_pdf_path, title: row.title } : null;
}
