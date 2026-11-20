import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { dateIn, PLATFORM_TIME_ZONE } from "@/lib/dates";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { normaliseEmail } from "@/lib/email-address";
import {
  EMAIL_CHANGE_HOURS,
  cleanName,
  emailChangeEmail,
  emailChangeTokenHash,
  makeEmailChangeToken,
  maskEmail,
  newAddress,
  type AddressProblem,
  type EmailChangeEmailKind,
  type NameProblem,
} from "@/lib/email-change";
import { renderEmail } from "@/lib/email-layout";
import type { RandomBytes } from "@/lib/recovery-codes";
import { siteUrl } from "@/lib/site";

import { auditAccount } from "./audit";
import { readSession, signedInRecently, type Account } from "./auth";
import { updateCustomerIn, type CustomerPatch } from "./customer-staff";
import { sendEmail, type OutgoingEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { endAccountGrants } from "./oauth";
import { budgetRoom } from "./request-budget";
import { adminAuth, type AdminClient } from "./supabase-admin";
import { col, typedRow, typedRows } from "./typed-rows";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** The two numbers the forms print, for Your account's actions, which load this module only when they run. */
export { EMAIL_CHANGE_HOURS, NAME_MAX } from "@/lib/email-change-limits";

/**
 * A person's own name and email (D836): the name changed on Your account (or corrected by a platform admin), and the email changed only
 * after a link sent to the new address is opened.
 *
 * - Asking for a change needs a strong, fresh session: the second step passed where the account has one, and a sign-in in the last ten
 *   minutes (`freshness()`), as closing a store or deleting an account does. A platform admin (an owner of the platform) may send the link
 *   for someone, after a fresh sign-in of their own, never set an address.
 * - The new address must be an address, not the account's, and no account's at all (said without saying whose). The change waits in
 *   `commerce.account_email_changes`: the address and a SHA-256 of the link's 32 random bytes, one per account, 24 hours; a new request
 *   replaces it. The link goes to the new address through the platform's own mailer, its token never in the email log (`secrets`), in logs or
 *   in the change log; the old address is told a change was asked for, with the new one half hidden.
 * - Opening the link shows a page; its button confirms (`confirmEmailChange()`): in one transaction the pending row and the account are
 *   locked, the link checked (known, unused, unexpired, the account active, the address still free), the account moved, the link marked
 *   used and Kaizena Flow's own customer of the person (D467) moved with them, and last Supabase Auth's email set with its admin API
 *   (confirmed, as the link proved it). If Supabase refuses, everything rolls back and the person is told. Nobody is signed in by it. The old
 *   address is then told, and every app and AI assistant the person connected asks again (as a new password does).
 * - An account with no Supabase Auth user yet (invited, never signed in) moves its address alone: its first sign-in links by the new one.
 * - Every step is in the change log for the platform and for each store the person works in (`auditAccount()`), with ids and which fields
 *   changed, never an address or a name as a value.
 */

/** What a request is refused for, in the words of Your account (`account.email.problems`). */
export type EmailChangeProblem = AddressProblem | "taken" | "sign_in_again" | "second_step" | "too_many" | "not_sent" | "not_found" | "none" | "own";

export type NameResult = { ok: true; name: string } | { ok: false; problem: NameProblem | "not_found" };
export type RequestResult = { ok: true; email: string } | { ok: false; problem: EmailChangeProblem };

/** What the email change needs from outside, given in by a test. */
export type EmailChangeDeps = {
  random?: RandomBytes;
  mail?: (message: OutgoingEmail) => Promise<SendOutcome>;
  admin?: () => AdminClient;
  /** The clock a link's end is read against. */
  now?: Date;
};

/** When it happened, on the platform's clock in the reader's language (`dateIn()`, D796), as the emails say it. */
const when = (at: Date | string, lang: AdminLang) => dateIn(PLATFORM_TIME_ZONE, at, "dayTime", lang);

// ---------------------------------------------------------------------------
// The name
// ---------------------------------------------------------------------------

/** The signed-in person's own name: trimmed, at most `NAME_MAX`, never empty. Shown wherever the account's name is read (the Team page, the change log, the platform's customers). */
export async function changeOwnName(account: Pick<Account, "id">, raw: unknown): Promise<NameResult> {
  return setName(account.id, raw, null);
}

/**
 * A platform admin corrects someone's name (D836, platform parity): the caller has checked the platform's `stores` area (support and owners).
 * Their own name is changed on Your account like anyone's.
 */
export async function correctName(actor: Account, accountId: string, raw: unknown): Promise<NameResult> {
  if (actor.id === accountId) return changeOwnName(actor, raw);
  return setName(accountId, raw, actor);
}

async function setName(accountId: string, raw: unknown, actor: Account | null): Promise<NameResult> {
  const clean = cleanName(raw);
  if (!clean.ok) return clean;
  const done = await db().transaction(async (tx) => {
    const before = await typedRow(
      z.object({ name: col.textOrNull }),
      sql`select name from commerce.accounts where id = ${accountId}::uuid and disabled_at is null for update`,
      tx,
    );
    if (!before) return null;
    if (before.name === clean.name) return { changed: false };
    await tx.execute(sql`update commerce.accounts set name = ${clean.name} where id = ${accountId}::uuid`);
    await followHouseCustomer(tx, accountId, { name: { from: before.name ?? "", to: clean.name } });
    return { changed: true };
  });
  if (!done) return { ok: false, problem: "not_found" };
  if (done.changed) {
    // A platform admin's correction names the person it was about (`label`, as a reset of their two-step does); the person's own needs none.
    await auditAccount(accountId, actor ? "account.name_corrected" : "account.name_changed", { via: actor ? "platform" : "self" }, {
      actorId: actor?.id ?? null,
      ...(actor ? { label: clean.name } : {}),
      changes: { name: { changed: true } },
    });
  }
  return { ok: true, name: clean.name };
}

// ---------------------------------------------------------------------------
// Kaizena Flow's own customer of the person (D467)
// ---------------------------------------------------------------------------

class Skip extends Error {}

/**
 * Kaizena Flow's own store keeps its owners as customers by address, a name filled in only while empty so what staff typed stays
 * (`syncHouseCustomers()`). So the person's customer follows only what still matches the account: a name still the old one takes the new
 * one, and an address still the old one moves to the new, its tags and notes with it (`updateCustomerIn()`), so their history stays theirs.
 * What staff wrote by hand is left. In a savepoint: a customer that cannot move (the new address is already a customer there) never stops
 * the change, and the five-minute sync links the account to that customer instead.
 */
async function followHouseCustomer(tx: Tx, accountId: string, change: { name?: { from: string; to: string }; email?: { from: string; to: string } }): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      const linked = await typedRow(
        z.object({ store_id: col.uuid, customer_id: col.uuid, name: col.text, email: col.text }),
        sql`
          select l.store_id, l.customer_id, c.name, lower(c.email) as email
          from commerce.house_customer_links l
          join commerce.stores s on s.id = l.store_id and s.house
          join commerce.customers c on c.store_id = l.store_id and c.id = l.customer_id
          where l.account_id = ${accountId}::uuid
          limit 1
        `,
        sp,
      );
      if (!linked) return;
      const patch: CustomerPatch = {};
      if (change.name && linked.name === change.name.from) patch.name = change.name.to;
      if (change.email && linked.email === normaliseEmail(change.email.from)) patch.email = change.email.to;
      if (Object.keys(patch).length === 0) return;
      const moved = await updateCustomerIn(sp, linked.store_id, linked.customer_id, patch);
      if (!moved.ok) throw new Skip();
    });
  } catch (error) {
    if (!(error instanceof Skip)) log("warn", "email_change.house_customer_left", { accountId }, error);
  }
}

// ---------------------------------------------------------------------------
// Asking for a change
// ---------------------------------------------------------------------------

/**
 * Whether this session may ask to change its email: the second step passed where the account has one (or where whether it has one could
 * not be read), and a sign-in in the last ten minutes.
 */
export async function freshness(): Promise<"ok" | "sign_in_again" | "second_step"> {
  const session = await readSession();
  if (!session) return "sign_in_again";
  if (session.level !== "aal2" && session.enrolled !== false) return "second_step";
  return (await signedInRecently()) ? "ok" : "sign_in_again";
}

/** Whether an address is another account's (any account, active or not: the unique index on `lower(email)` holds them all). */
async function addressTaken(email: string, accountId: string, runner?: Tx): Promise<boolean> {
  const row = await typedRow(
    z.object({ taken: col.bool }),
    sql`select exists (select 1 from commerce.accounts where lower(email) = ${normaliseEmail(email)} and id <> ${accountId}::uuid) as taken`,
    runner,
  );
  return Boolean(row?.taken);
}

/** The signed-in person asks to move their account to a new address: a link goes to it, a notice to their own. */
export async function requestEmailChange(account: Pick<Account, "id">, raw: unknown, deps: EmailChangeDeps = {}): Promise<RequestResult> {
  const fresh = await freshness();
  if (fresh !== "ok") return { ok: false, problem: fresh };
  return startChange(account.id, raw, account.id, deps);
}

/** The pending change's link again, with a new token (the old link stops working) and a new 24 hours. */
export async function resendEmailChange(account: Pick<Account, "id">, deps: EmailChangeDeps = {}): Promise<RequestResult> {
  const fresh = await freshness();
  if (fresh !== "ok") return { ok: false, problem: fresh };
  const pending = await pendingEmailChange(account.id);
  if (!pending) return { ok: false, problem: "none" };
  return startChange(account.id, pending.email, account.id, deps);
}

/**
 * A platform admin sends the link for someone (D836, platform parity), to an address they were given: the email changes only when the link
 * is opened, and the person's current address is told. Owners of the platform only (the caller asks `requirePlatformAdmin()`), after a
 * sign-in of their own in the last ten minutes, as changing the team does; never for themselves.
 */
export async function sendEmailChangeFor(actor: Account, accountId: string, raw: unknown, deps: EmailChangeDeps & { fresh?: boolean } = {}): Promise<RequestResult> {
  if (!actor.platformAdmin) return { ok: false, problem: "not_found" };
  if (actor.id === accountId) return { ok: false, problem: "own" };
  if (!(deps.fresh ?? (await signedInRecently()))) return { ok: false, problem: "sign_in_again" };
  return startChange(accountId, raw, actor.id, deps);
}

async function startChange(accountId: string, raw: unknown, requestedBy: string, deps: EmailChangeDeps): Promise<RequestResult> {
  const person = await typedRow(
    z.object({ email: col.text, name: col.textOrNull, admin_locale: col.textOrNull }),
    sql`select email, name, admin_locale from commerce.accounts where id = ${accountId}::uuid and disabled_at is null`,
  );
  if (!person) return { ok: false, problem: "not_found" };
  const checked = newAddress(raw, person.email);
  if (!checked.ok) return checked;
  if (await addressTaken(checked.email, accountId)) return { ok: false, problem: "taken" };
  // Counted on the person's account, whoever asks; a count that fails refuses (`FAIL_CLOSED`).
  const room = await budgetRoom(null, "email_change", accountId);
  if (!room.visitor || !room.store) return { ok: false, problem: "too_many" };

  const { token, hash } = makeEmailChangeToken(deps.random ?? randomBytes);
  const row = await typedRow(
    z.object({ id: col.uuid, created_at: col.timestamp }),
    sql`
      insert into commerce.account_email_changes (account_id, new_email, token_hash, requested_by, expires_at)
      values (${accountId}::uuid, ${checked.email}, ${hash}, ${requestedBy}::uuid, now() + make_interval(hours => ${EMAIL_CHANGE_HOURS}))
      on conflict (account_id) do update set new_email = excluded.new_email, token_hash = excluded.token_hash, requested_by = excluded.requested_by,
        created_at = now(), expires_at = excluded.expires_at, used_at = null
      returning id, created_at
    `,
  );
  if (!row) return { ok: false, problem: "not_sent" };
  const byAdmin = requestedBy !== accountId;
  const lang = adminLangOf(person.admin_locale);
  const greeting = person.name || person.email;
  const mail = deps.mail ?? sendEmail;
  const link = `${siteUrl()}/admin/account/email/confirm?token=${token}`;
  const sent = await mail({
    storeId: null,
    kind: "security.email_change_confirm",
    to: checked.email,
    email: renderEmail(emailChangeEmail("confirm", { person: greeting, email: checked.email, when: when(row.created_at, lang), byAdmin, url: link }, STAFF_EMAILS_WORDS[lang], lang)),
    fromName: "Kaizena Flow",
    idempotencyKey: `security.email_change_confirm:${row.id}:${row.created_at}`,
    // The link is the change's whole key: the log's copy never holds it.
    secrets: [token],
  });
  if (sent === "failed") {
    // Nothing waits on a link that never went: the row goes, so the person is not shown a change they cannot finish.
    await db().execute(sql`delete from commerce.account_email_changes where id = ${row.id}::uuid and token_hash = ${hash}`);
    log("warn", "email_change.link_not_sent", { accountId });
    return { ok: false, problem: "not_sent" };
  }
  await notify(accountId, "requested", { email: maskEmail(checked.email), byAdmin, at: new Date(row.created_at), deps });
  await auditAccount(accountId, byAdmin ? "account.email_change_sent" : "account.email_change_requested", { via: byAdmin ? "platform" : "self", change: row.id }, {
    actorId: byAdmin ? requestedBy : null,
    ...(byAdmin ? { label: person.name || maskEmail(person.email) } : {}),
  });
  log("info", "email_change.requested", { accountId, change: row.id, byAdmin });
  return { ok: true, email: checked.email };
}

/** A notice to the account's own (current, or for `changed` the old) address. Never throws: the change stands without it. */
async function notify(accountId: string, kind: Exclude<EmailChangeEmailKind, "confirm">, facts: { email: string; byAdmin: boolean; at: Date; to?: string; deps: EmailChangeDeps }): Promise<void> {
  try {
    const person = await typedRow(
      z.object({ email: col.text, name: col.textOrNull, admin_locale: col.textOrNull }),
      sql`select email, name, admin_locale from commerce.accounts where id = ${accountId}::uuid`,
    );
    if (!person) return;
    const lang: AdminLang = adminLangOf(person.admin_locale);
    const to = facts.to ?? person.email;
    await (facts.deps.mail ?? sendEmail)({
      storeId: null,
      kind: `security.email_change_${kind}`,
      to,
      email: renderEmail(
        emailChangeEmail(kind, { person: person.name || to, email: facts.email, when: when(facts.at, lang), byAdmin: facts.byAdmin, url: `${siteUrl()}/admin/sign-in` }, STAFF_EMAILS_WORDS[lang], lang),
      ),
      fromName: "Kaizena Flow",
      idempotencyKey: `security.email_change_${kind}:${accountId}:${facts.at.toISOString()}`,
    });
  } catch (error) {
    log("error", "email_change.notice_failed", { accountId, kind }, error);
  }
}

// ---------------------------------------------------------------------------
// The pending change: Your account's line, cancelling it
// ---------------------------------------------------------------------------

export type PendingEmailChange = { email: string; createdAt: string; expiresAt: string; byAdmin: boolean; expired: boolean };

/** The change an account waits on (expired ones too, so the page can say so), or null. */
export async function pendingEmailChange(accountId: string, now: Date = new Date()): Promise<PendingEmailChange | null> {
  const row = await typedRow(
    z.object({ new_email: col.text, created_at: col.timestamp, expires_at: col.timestamp, by_admin: col.bool }),
    sql`
      select new_email, created_at, expires_at, requested_by <> account_id as by_admin
      from commerce.account_email_changes where account_id = ${accountId}::uuid and used_at is null
    `,
  );
  if (!row) return null;
  return { email: row.new_email, createdAt: row.created_at, expiresAt: row.expires_at, byAdmin: row.by_admin, expired: new Date(row.expires_at).getTime() <= now.getTime() };
}

/** Cancels the account's pending change (by the person, or by a platform admin for them): its link stops working. False when none waited. */
export async function cancelEmailChange(accountId: string, actor: Pick<Account, "id"> | null = null): Promise<boolean> {
  const gone = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.account_email_changes where account_id = ${accountId}::uuid and used_at is null returning id`,
  );
  if (gone.length === 0) return false;
  const byOther = actor !== null && actor.id !== accountId;
  await auditAccount(accountId, "account.email_change_cancelled", { via: byOther ? "platform" : "self", change: gone[0].id }, { actorId: byOther ? actor.id : null });
  log("info", "email_change.cancelled", { accountId, byOther });
  return true;
}

// ---------------------------------------------------------------------------
// Opening the link
// ---------------------------------------------------------------------------

/** `used` names the address too: the page says the account has it now (whoever holds the link holds that address). */
export type LinkState =
  | { state: "valid" | "used"; email: string; lang: AdminLang }
  | { state: "expired"; lang: AdminLang }
  | { state: "unknown" };

/** What a link is, for its page: nothing changes by reading it (a mail scanner that opens the link changes nothing). */
export async function emailChangeLink(token: unknown, now: Date = new Date()): Promise<LinkState> {
  const hash = emailChangeTokenHash(token);
  if (!hash) return { state: "unknown" };
  const row = await typedRow(
    z.object({ new_email: col.text, expires_at: col.timestamp, used_at: col.timestampOrNull, admin_locale: col.textOrNull, active: col.bool }),
    sql`
      select c.new_email, c.expires_at, c.used_at, a.admin_locale, a.disabled_at is null as active
      from commerce.account_email_changes c join commerce.accounts a on a.id = c.account_id
      where c.token_hash = ${hash}
    `,
  );
  if (!row || !row.active) return { state: "unknown" };
  const lang = adminLangOf(row.admin_locale);
  if (row.used_at) return { state: "used", email: row.new_email, lang };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { state: "expired", lang };
  return { state: "valid", email: row.new_email, lang };
}

export type ConfirmResult =
  | { ok: true; email: string; lang: AdminLang }
  | { ok: false; problem: "unknown" | "expired" | "used" | "taken" | "failed"; lang: AdminLang | null };

/** Why the transaction stopped on purpose: its writes roll back with it. */
class Refused extends Error {
  constructor(readonly problem: "taken" | "failed") {
    super(problem);
  }
}

/** Whether an error is the unique index on accounts' addresses: two changes to one address, the later one refused. */
function isTakenError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const fields = e as { code?: string; constraint_name?: string; constraint?: string; message?: string };
    if (fields.code === "23505" && /accounts_email_idx/.test(`${fields.constraint_name ?? fields.constraint ?? ""} ${fields.message ?? ""}`)) return true;
  }
  return false;
}

/**
 * The link's button: the account moves to the new address, or nothing changes. One transaction locks the pending row and the account, checks
 * the link (known, unused, unexpired, the account active, the address still free), moves the account and the person's customer of Kaizena
 * Flow, marks the link used, and last asks Supabase Auth to take the new address (confirmed: the link proved it). Supabase refusing rolls it
 * all back; a commit that fails after Supabase took the address puts Supabase back. Nobody is signed in by it.
 */
export async function confirmEmailChange(token: unknown, deps: EmailChangeDeps = {}): Promise<ConfirmResult> {
  const hash = emailChangeTokenHash(token);
  if (!hash) return { ok: false, problem: "unknown", lang: null };
  const now = deps.now ?? new Date();
  // Written inside the transaction, read after it: the person's language once the row is read, and whether Supabase already took the address.
  const seen: { lang: AdminLang | null; authMoved: { userId: string; from: string } | null } = { lang: null, authMoved: null };
  try {
    const done = await db().transaction(async (tx) => {
      const row = await typedRow(
        z.object({
          id: col.uuid,
          account_id: col.uuid,
          new_email: col.text,
          expires_at: col.timestamp,
          used_at: col.timestampOrNull,
          requested_by: col.uuid,
          email: col.text,
          auth_user_id: col.uuid.nullable(),
          admin_locale: col.textOrNull,
          active: col.bool,
        }),
        sql`
          select c.id, c.account_id, c.new_email, c.expires_at, c.used_at, c.requested_by, a.email, a.auth_user_id, a.admin_locale,
                 a.disabled_at is null as active
          from commerce.account_email_changes c join commerce.accounts a on a.id = c.account_id
          where c.token_hash = ${hash}
          for update of c, a
        `,
        tx,
      );
      if (!row || !row.active) return { ok: false as const, problem: "unknown" as const };
      seen.lang = adminLangOf(row.admin_locale);
      if (row.used_at) return { ok: false as const, problem: "used" as const };
      if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false as const, problem: "expired" as const };
      if (await addressTaken(row.new_email, row.account_id, tx)) return { ok: false as const, problem: "taken" as const };

      await tx.execute(sql`update commerce.accounts set email = ${row.new_email} where id = ${row.account_id}::uuid`);
      await tx.execute(sql`update commerce.account_email_changes set used_at = now() where id = ${row.id}::uuid`);
      await followHouseCustomer(tx, row.account_id, { email: { from: row.email, to: row.new_email } });

      // Supabase Auth last, while the rows are still locked: if it refuses, everything above rolls back.
      if (row.auth_user_id) {
        const client = (deps.admin ?? adminAuth)();
        if (!client.ok) throw new Refused("failed");
        const { error } = await client.admin.updateUserById(row.auth_user_id, { email: row.new_email, email_confirm: true });
        if (error) throw new Refused((error as { code?: string }).code === "email_exists" ? "taken" : "failed");
        seen.authMoved = { userId: row.auth_user_id, from: row.email };
      }
      return { ok: true as const, change: row.id, accountId: row.account_id, from: row.email, email: row.new_email, byAdmin: row.requested_by !== row.account_id };
    });
    if (!done.ok) return { ...done, lang: seen.lang };
    await auditAccount(done.accountId, "account.email_changed", { via: done.byAdmin ? "platform" : "self", change: done.change }, { changes: { email: { changed: true } } });
    // What the person let apps and AI assistants do is asked again, as after a new password (D439 review).
    await endAccountGrants(done.accountId, "email").catch((error) => log("error", "email_change.grants_left", { accountId: done.accountId }, error));
    await notify(done.accountId, "changed", { email: maskEmail(done.email), byAdmin: done.byAdmin, at: now, to: done.from, deps });
    log("info", "email_change.confirmed", { accountId: done.accountId, change: done.change, auth: seen.authMoved !== null });
    return { ok: true, email: done.email, lang: seen.lang ?? "en" };
  } catch (error) {
    if (error instanceof Refused) {
      log("warn", "email_change.auth_refused", { problem: error.problem });
      return { ok: false, problem: error.problem, lang: seen.lang };
    }
    // Supabase took the address but the transaction did not commit: Supabase is put back, so the two never disagree.
    const moved = seen.authMoved;
    if (moved) {
      const client = (deps.admin ?? adminAuth)();
      if (client.ok) {
        await client.admin
          .updateUserById(moved.userId, { email: moved.from, email_confirm: true })
          .then(({ error: back }) => back && log("error", "email_change.auth_not_restored", {}, back))
          .catch((back: unknown) => log("error", "email_change.auth_not_restored", {}, back));
      }
    }
    if (isTakenError(error)) return { ok: false, problem: "taken", lang: seen.lang };
    throw error;
  }
}
