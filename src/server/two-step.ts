import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { normaliseRecoveryCode, type RandomBytes } from "@/lib/recovery-codes";
import { createClient } from "@/lib/supabase/server";
import { attemptState, lockedText, normaliseTotp, TWO_STEP_LIMIT } from "@/lib/two-step";

import { auditAccount, auditChange } from "./audit";
import { readSession, type Account, type Membership } from "./auth";
import { memberCan, NO_ACCESS } from "./permissions";
import { refreshTag } from "./refresh";
import { claimRecoveryCode, makeRecoveryCodes, recoveryAvailable, recoveryCodesLeft, revokeRecoveryCodes } from "./recovery-codes";
import { sendSecurityEmail } from "./security-emails";
import { adminAuth, type AdminAuth } from "./supabase-admin";
import { storeTag } from "./stores";

type Row = Record<string, unknown>;

/**
 * Two-step sign-in, the server's side (wave 1, 1f, docs/wave-1-trust.md 2.6, 2.8, 4.5): enrolling an authenticator app with
 * recovery codes, passing the second step at sign-in, using a recovery code, switching it off, a platform admin's reset and the
 * store's requirement. Supabase Auth does the TOTP (`auth.mfa.*`); this module decides the rest.
 *
 * Where a page or action may let a person through is `getAccount()` (`auth.ts`), which fails closed; nothing here is read for that.
 * Enrolment is read from the Auth server (`getUser()`), never from the session cookie's copy of the user, and `accounts.two_step_since`
 * is a mirror for display. Every event is audit-logged for the platform and for each of the person's stores (`auditAccount()`).
 */

export type StepResult = { ok: true } | { ok: false; problem: string; locked?: boolean };

const WRONG = "That code did not work. Check the time on your phone and try the next code.";
const SIGNED_OUT = "Sign in again to continue.";
const UNAVAILABLE = "We could not check your two-step status. Try again.";

type Factor = { id: string; status?: string; factor_type?: string };

/** The account's factors as the Auth server holds them (never the cookie's copy), or null when it could not be asked. */
async function factorsOf(): Promise<{ factors: Factor[]; userId: string } | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return { factors: (data.user.factors ?? []) as Factor[], userId: data.user.id };
  } catch {
    return null;
  }
}

/** The attempts of an account that were not shown to be right, in the last hour: reserved before the code is checked, cleared when it passes. */
const OPEN_ATTEMPTS = (accountId: string, now: Date) => sql`
  select a.created_at from commerce.audit_log a
  where a.account_id = ${accountId}::uuid and a.store_id is null and a.created_at > ${now.toISOString()}::timestamptz - interval '1 hour'
    and (
      (a.action = 'account.two_step_attempt'
        and not exists (
          select 1 from commerce.audit_log r
          where r.account_id = a.account_id and r.store_id is null
            and r.action in ('account.two_step_passed', 'account.two_step_enrolled', 'account.recovery_code_used', 'account.two_step_attempt_cleared')
            and r.details ->> 'attempt' = a.details ->> 'key'
        ))
      -- Wrong codes written before attempts were reserved (and by hand): counted as they were.
      or (a.action = 'account.two_step_failed' and a.details ->> 'attempt' is null)
    )
`;

/** Where an account stands on wrong codes: from the attempts the audit log holds, the last hour of them. */
export async function attemptsOf(accountId: string, now: Date = new Date()) {
  const rows = await db().execute<Row>(OPEN_ATTEMPTS(accountId, now));
  return attemptState(rows.map((row) => new Date(String(row.created_at))), now);
}

type Reservation = { ok: true; key: string } | { ok: false; problem: string; locked: true };

/**
 * Takes one of the account's five tries BEFORE the code is checked, under a lock per account, so parallel guesses cannot all see
 * "no failures yet" and all reach the Auth server: the check of the limit and the writing of the try are one step. The try counts
 * until it passes (the success entry names it with `attempt`) or is cleared (`clearAttempt()`, when the Auth server could not be
 * asked), so a wrong code needs no entry of its own to count. Only the platform's row is written (`perStore: false`).
 */
async function reserveAttempt(accountId: string, via: "totp" | "recovery" | "enrol", clock?: Date): Promise<Reservation> {
  const key = crypto.randomUUID();
  const state = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`two_step:${accountId}`}, 0))`);
    // The clock is read once the lock is held: an entry's time is its transaction's start, so a clock read before waiting could be earlier than an entry the wait let through.
    const now = clock ?? new Date();
    const rows = await tx.execute<Row>(OPEN_ATTEMPTS(accountId, now));
    const current = attemptState(rows.map((row) => new Date(String(row.created_at))), now);
    if (current.locked) return current;
    await tx.execute(sql`
      insert into commerce.audit_log (account_id, store_id, action, details, area, target_type, target_id)
      values (${accountId}::uuid, null, 'account.two_step_attempt', ${JSON.stringify({ via, key })}::jsonb, 'account', 'account', ${accountId})
    `);
    return current;
  });
  return state.locked ? { ok: false, problem: lockedText(state.minutes), locked: true } : { ok: true, key };
}

/** Gives the try back: the Auth server could not be asked, which is no fault of the person's. */
async function clearAttempt(accountId: string, key: string): Promise<void> {
  await auditAccount(accountId, "account.two_step_attempt_cleared", { attempt: key }, { perStore: false });
}

/** The wrong code's own entry, for the platform and each store's log; the try it used was reserved already, so this one carries its key and counts for nothing. */
async function recordFailure(accountId: string, via: "totp" | "recovery" | "enrol", attempt: string): Promise<void> {
  await auditAccount(accountId, "account.two_step_failed", { via, attempt });
}

/** The words for a wrong code, with how many tries are left once it is down to the last ones. */
function wrongText(remaining: number): string {
  return remaining <= 2 ? `${WRONG} ${remaining === 1 ? "One try" : `${remaining} tries`} left before a pause.` : WRONG;
}

// ---------------------------------------------------------------------------
// Enrolling
// ---------------------------------------------------------------------------

export type EnrolStart = { ok: true; factorId: string; qrCode: string; secret: string; uri: string } | { ok: false; problem: string };

/**
 * Starts enrolling an authenticator app: removes any half-finished attempt (an unverified factor), asks Supabase for a new TOTP
 * factor and returns what the page shows: the QR code (an SVG), the secret to type by hand and the `otpauth://` address. Refused
 * where the person already has a factor, and where recovery codes could not be made (a person must never be left without a way back).
 */
export async function startEnrolment(now: Date = new Date()): Promise<EnrolStart> {
  if (!recoveryAvailable()) return { ok: false, problem: "Two-step sign-in cannot be set up on this server: it has no key for recovery codes." };
  const known = await factorsOf();
  if (!known) return { ok: false, problem: UNAVAILABLE };
  if (known.factors.some((factor) => factor.status === "verified")) return { ok: false, problem: "Two-step sign-in is already on for your account." };
  try {
    const supabase = await createClient();
    for (const stale of known.factors.filter((factor) => factor.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: stale.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Kaizen Store", friendlyName: `Authenticator ${now.toISOString()}` });
    if (error || !data || data.type !== "totp") return { ok: false, problem: "Two-step sign-in could not be started. Try again." };
    return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
  } catch {
    return { ok: false, problem: "Two-step sign-in could not be started. Try again." };
  }
}

export type EnrolFinish = { ok: true; codes: string[] } | { ok: false; problem: string; locked?: boolean };

/**
 * Finishes enrolling: the first code from the app proves it was set up, the factor becomes active, and ten recovery codes are
 * made and returned to be shown once. The attempt limit counts wrong codes here too. The person's other sessions end (Supabase's own
 * rule when a factor is verified); the one that verified is promoted.
 */
export async function finishEnrolment(account: Account, factorId: string, typed: string, options: { now?: Date; random?: RandomBytes } = {}): Promise<EnrolFinish> {
  const clock = options.now;
  const now = clock ?? new Date();
  const code = normaliseTotp(typed);
  if (!code) return { ok: false, problem: "Type the six digits from your authenticator app." };
  const known = await factorsOf();
  if (!known) return { ok: false, problem: UNAVAILABLE };
  const factor = known.factors.find((f) => f.id === factorId);
  if (!factor || factor.status === "verified") return { ok: false, problem: "That set-up has expired. Start again." };
  const attempt = await reserveAttempt(account.id, "enrol", clock);
  if (!attempt.ok) return attempt;
  try {
    const supabase = await createClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) {
      await clearAttempt(account.id, attempt.key);
      return { ok: false, problem: UNAVAILABLE };
    }
    const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    if (verified.error) {
      await recordFailure(account.id, "enrol", attempt.key);
      const after = await attemptsOf(account.id, clock ? now : new Date());
      return { ok: false, problem: after.locked ? lockedText(after.minutes) : wrongText(after.remaining), locked: after.locked };
    }
  } catch {
    await clearAttempt(account.id, attempt.key);
    return { ok: false, problem: UNAVAILABLE };
  }

  const set = await makeRecoveryCodes(account.id, options.random);
  await db().execute(sql`update commerce.accounts set two_step_since = now(), two_step_reenrol_at = null where id = ${account.id}::uuid`);
  await auditAccount(account.id, "account.two_step_enrolled", { attempt: attempt.key });
  await auditAccount(account.id, "account.recovery_codes_generated", {}, { perStore: false });
  // The factor is on and the account is safe even if the set could not be made (the key was checked when enrolment started).
  return set.ok ? { ok: true, codes: set.codes } : { ok: false, problem: set.problem };
}

// ---------------------------------------------------------------------------
// Passing the second step
// ---------------------------------------------------------------------------

/** The sign-in's second step: the six digits from the app. Five wrong in 15 minutes pause the account for 15 minutes (`TWO_STEP_LIMIT`). */
export async function passSecondStep(account: Account, typed: string, clock?: Date): Promise<StepResult> {
  const now = clock ?? new Date();
  const state = await attemptsOf(account.id, now);
  if (state.locked) return { ok: false, problem: lockedText(state.minutes), locked: true };
  const code = normaliseTotp(typed);
  if (!code) return { ok: false, problem: "Type the six digits from your authenticator app." };
  const known = await factorsOf();
  if (!known) return { ok: false, problem: UNAVAILABLE };
  const factor = known.factors.find((f) => f.status === "verified" && (f.factor_type ?? "totp") === "totp");
  if (!factor) return { ok: false, problem: SIGNED_OUT };
  // The try is taken here, before the code is checked, under the account's lock: the early read above only spares the lock for a person already paused.
  const attempt = await reserveAttempt(account.id, "totp", clock);
  if (!attempt.ok) return attempt;
  try {
    const supabase = await createClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error || !challenge.data) {
      await clearAttempt(account.id, attempt.key);
      return { ok: false, problem: UNAVAILABLE };
    }
    const verified = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code });
    if (verified.error) {
      await recordFailure(account.id, "totp", attempt.key);
      const after = await attemptsOf(account.id, clock ? now : new Date());
      return { ok: false, problem: after.locked ? lockedText(after.minutes) : wrongText(after.remaining), locked: after.locked };
    }
  } catch {
    await clearAttempt(account.id, attempt.key);
    return { ok: false, problem: UNAVAILABLE };
  }
  await auditAccount(account.id, "account.two_step_passed", { attempt: attempt.key }, { perStore: false });
  return { ok: true };
}

/**
 * The way back when the phone is lost: a recovery code is checked against the account's unused codes and spent in the same
 * statement (so it works once), the account's factors are removed through Supabase's admin API (which ends all its sessions),
 * the other codes are revoked, the account is held at enrolment next time whatever else is true (`two_step_reenrol_at`), and an
 * email goes to the account's own address. Where the server cannot remove factors (no secret key) **nothing is spent**: the
 * person is told to ask a platform admin. The same limit on wrong attempts applies as at the second step.
 */
export async function useRecoveryCode(account: Account, typed: string, clock?: Date): Promise<StepResult> {
  const now = clock ?? new Date();
  const state = await attemptsOf(account.id, now);
  if (state.locked) return { ok: false, problem: lockedText(state.minutes), locked: true };
  if (!normaliseRecoveryCode(typed)) return { ok: false, problem: "Type a recovery code: ten letters and digits, like K7QM2-9WXDB." };
  const admin = adminAuth();
  if (!admin.ok || !recoveryAvailable()) return { ok: false, problem: admin.ok ? "Recovery is not available on this server. Ask a platform admin to reset your two-step." : admin.problem };

  const attempt = await reserveAttempt(account.id, "recovery", clock);
  if (!attempt.ok) return attempt;
  if (!(await claimRecoveryCode(account.id, typed))) {
    await recordFailure(account.id, "recovery", attempt.key);
    const after = await attemptsOf(account.id, clock ? now : new Date());
    return { ok: false, problem: after.locked ? lockedText(after.minutes) : "That recovery code did not work. Each code works once.", locked: after.locked };
  }

  // From here the code is spent: the account is marked for re-enrolment first, so even a failed removal leaves it re-enrolling.
  await db().execute(sql`update commerce.accounts set two_step_since = null, two_step_reenrol_at = now() where id = ${account.id}::uuid`);
  const removed = await removeAllFactors(account.id, admin.admin);
  const left = await revokeRecoveryCodes(account.id);
  await auditAccount(account.id, "account.recovery_code_used", { attempt: attempt.key, factorsRemoved: removed.removed, ...(removed.ok ? {} : { removalFailed: true }), codesRevoked: left });
  await sendSecurityEmail(account.id, "recovery_code_used", { at: now, codesLeft: 0 });
  if (!removed.ok) return { ok: false, problem: "Your recovery code was accepted, but your two-step could not be removed. Ask a platform admin to reset it." };
  return { ok: true };
}

/** Removes every factor of an account through Supabase's admin API; `ok` is false when any removal failed. */
async function removeAllFactors(accountId: string, admin: AdminAuth): Promise<{ ok: boolean; removed: number }> {
  const [row] = await db().execute<Row>(sql`select auth_user_id from commerce.accounts where id = ${accountId}::uuid`);
  const userId = row?.auth_user_id ? String(row.auth_user_id) : null;
  if (!userId) return { ok: true, removed: 0 };
  try {
    const listed = await admin.mfa.listFactors({ userId });
    if (listed.error) return { ok: false, removed: 0 };
    let removed = 0;
    let ok = true;
    for (const factor of listed.data.factors) {
      const gone = await admin.mfa.deleteFactor({ id: factor.id, userId });
      if (gone.error) ok = false;
      else removed += 1;
    }
    return { ok, removed };
  } catch (error) {
    console.error("[two-step] factors could not be removed", error);
    return { ok: false, removed: 0 };
  }
}

// ---------------------------------------------------------------------------
// Changing it, from Your account (an `aal2` session) and by a platform admin
// ---------------------------------------------------------------------------

/** Where a person stands, for Your account: whether a second step is on, how many recovery codes are left, and whether this session has passed it. */
export async function twoStepStatus(account: Pick<Account, "id">): Promise<{ enrolled: boolean; verified: boolean; codesLeft: number; recoveryAvailable: boolean } | null> {
  const session = await readSession();
  if (!session) return null;
  return {
    enrolled: session.enrolled === true,
    verified: session.level === "aal2",
    codesLeft: await recoveryCodesLeft(account.id),
    recoveryAvailable: recoveryAvailable(),
  };
}

const CONFIRM = "Confirm your second step first: sign out and in again, and type the code from your authenticator app.";

/** Whether this session has passed its second step (Supabase's rule for changing a verified factor, and ours for changing the codes). */
async function onSecondStep(): Promise<boolean> {
  const session = await readSession();
  return Boolean(session && session.level === "aal2");
}

/** Makes a new set of recovery codes, revoking the old; needs a session that has passed the second step. Returns the codes to show once. */
export async function regenerateRecoveryCodes(account: Account, random?: RandomBytes): Promise<EnrolFinish> {
  if (!(await onSecondStep())) return { ok: false, problem: CONFIRM };
  const set = await makeRecoveryCodes(account.id, random);
  if (!set.ok) return { ok: false, problem: set.problem };
  await auditAccount(account.id, "account.recovery_codes_generated", {}, { perStore: false });
  return { ok: true, codes: set.codes };
}

/** Switches two-step off for the person: the factor is removed (Supabase needs a session at `aal2` for that), the codes revoked, an email sent. */
export async function removeSecondStep(account: Account): Promise<StepResult> {
  if (!(await onSecondStep())) return { ok: false, problem: CONFIRM };
  const known = await factorsOf();
  if (!known) return { ok: false, problem: UNAVAILABLE };
  try {
    const supabase = await createClient();
    for (const factor of known.factors) {
      const gone = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (gone.error) return { ok: false, problem: "Two-step sign-in could not be switched off. Try again." };
    }
  } catch {
    return { ok: false, problem: "Two-step sign-in could not be switched off. Try again." };
  }
  await db().execute(sql`update commerce.accounts set two_step_since = null where id = ${account.id}::uuid`);
  await revokeRecoveryCodes(account.id);
  await auditAccount(account.id, "account.two_step_removed");
  await sendSecurityEmail(account.id, "two_step_removed");
  return { ok: true };
}

/**
 * A platform admin takes a lost second step away from an account (no phone and no recovery code): its factors are removed, its
 * codes revoked and it is held at enrolment next time. Audit-logged for the platform and for each of the person's stores, and the
 * person is emailed. A platform admin cannot reset themselves here (Your account is the way, and another admin the fallback).
 */
export async function resetTwoStep(actor: Account, targetAccountId: string): Promise<StepResult & { removed?: number }> {
  if (!actor.platformAdmin) return { ok: false, problem: NO_ACCESS };
  if (actor.id === targetAccountId) return { ok: false, problem: "Change your own two-step on Your account. Another platform admin can reset it if you are locked out." };
  const admin = adminAuth();
  if (!admin.ok) return { ok: false, problem: admin.problem };
  const [target] = await db().execute<Row>(sql`select email, name from commerce.accounts where id = ${targetAccountId}::uuid`);
  if (!target) return { ok: false, problem: "That account does not exist." };
  await db().execute(sql`update commerce.accounts set two_step_since = null, two_step_reenrol_at = now() where id = ${targetAccountId}::uuid`);
  const removed = await removeAllFactors(targetAccountId, admin.admin);
  await revokeRecoveryCodes(targetAccountId);
  await auditAccount(targetAccountId, "account.two_step_reset", { by: actor.email, factorsRemoved: removed.removed, ...(removed.ok ? {} : { removalFailed: true }) }, { actorId: actor.id, label: String(target.name || target.email) });
  await sendSecurityEmail(targetAccountId, "two_step_reset", { by: actor.email });
  if (!removed.ok) return { ok: false, problem: "Some of the factors could not be removed. Try again." };
  return { ok: true, removed: removed.removed };
}

// ---------------------------------------------------------------------------
// The store's requirement
// ---------------------------------------------------------------------------

/**
 * An owner requires two-step of every member of the store, or stops. Switching it on needs the owner's own second step passed in
 * this session, so they cannot lock themselves out. A member without a factor is held at enrolment before the store's admin;
 * other stores of the same person are not affected. Audit-logged and the store's cache refreshed.
 */
export async function setTwoStepRequirement(member: Membership, required: boolean): Promise<StepResult> {
  if (!memberCan(member, "owner")) return { ok: false, problem: NO_ACCESS };
  const [row] = await db().execute<Row>(sql`select require_two_step from commerce.stores where id = ${member.store.id}::uuid`);
  const before = Boolean(row?.require_two_step);
  if (required && !before) {
    const session = await readSession();
    if (!session || session.level !== "aal2") return { ok: false, problem: "Set up two-step sign-in for yourself and sign in with it before you require it of the team, so you cannot lock yourself out." };
  }
  if (required === before) return { ok: true };
  await db().execute(sql`update commerce.stores set require_two_step = ${required} where id = ${member.store.id}::uuid`);
  await auditChange(member, required ? "store.two_step_required" : "store.two_step_optional", { type: "store", id: member.store.id, label: member.store.name }, { requireTwoStep: before }, { requireTwoStep: required }, "store");
  refreshTag(storeTag(member.store.slug));
  return { ok: true };
}

export type TwoStepMember = { accountId: string; email: string; name: string | null; hasTwoStep: boolean };

/** The store's active members and whether each is seen to have a second step (the display mirror, not an access decision): "3 of 5 have it". */
export async function twoStepMembers(storeId: string): Promise<TwoStepMember[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, a.email, a.name, a.two_step_since is not null as has
    from commerce.store_members m join commerce.accounts a on a.id = m.account_id
    where m.store_id = ${storeId}::uuid and m.disabled_at is null
    order by lower(a.email)
  `);
  return rows.map((row) => ({ accountId: String(row.id), email: String(row.email), name: row.name ? String(row.name) : null, hasTwoStep: Boolean(row.has) }));
}

export { TWO_STEP_LIMIT };
