import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { kaizenLifeLinkKeys } from "@/lib/env";
import { FLOW_ISSUER, LIFE_ISSUER, linkEmail, signLinkRequest } from "@/lib/kaizen-life-jwt";

import { audit } from "./auth";
import { sendKaizenLifeLinkedEmail } from "./kaizen-life-emails";
import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * Kaizen Life's account link (docs/life-work-summary.md 3.3): which Kaizen Life user an account is, kept in
 * `commerce.kaizen_life_accounts` and written only here. It is made by itself once the person has both: by a sign-in with the
 * other app (`identity`), or by the same email proved on both sides (`email`). It gives Kaizen Life one thing, the account's
 * read-only Work summary. The person undoes it in either app, and an undone pair is never linked again by itself: only their own
 * sign-in with the other app (`identity`) links it again. Kaizen Life keeps a copy, written in the same call that changes the link,
 * so a link Kaizen Life did not take is undone here.
 *
 * Nothing is linked while the keys are not set (`kaizenLifeLinkKeys()`).
 */
export type LinkHow = "identity" | "email" | "backfill";
export type LifeLink = { lifeUserId: string; how: LinkHow; linkedAt: string };

export type LinkOutcome =
  | { kind: "linked"; link: LifeLink; revived: { unlinkedAt: string; unlinkedFrom: string } | null }
  | { kind: "already"; link: LifeLink }
  | { kind: "refused"; reason: "no_account" | "undone" | "taken" | "life" };

/** Kaizen Life's doors that Kaizena Flow asks (Kaizen Life serves them). */
export const LIFE_DOORS = {
  lookup: "/api/kaizena-flow/v1/lookup",
  link: "/api/kaizena-flow/v1/link",
  unlink: "/api/kaizena-flow/v1/unlink",
} as const;

/** Kaizena Flow's doors that Kaizen Life asks (`src/app/api/kaizen-life/v1/[door]/route.ts`). */
export const FLOW_DOORS = ["link", "unlink", "status", "work-summary"] as const;
export type FlowDoor = (typeof FLOW_DOORS)[number];
export const flowDoorPath = (door: FlowDoor) => `/api/kaizen-life/v1/${door}`;

const ASK_TIMEOUT_MS = 5_000;

const lifeUrl = () => (process.env.KAIZEN_LIFE_URL?.trim() || "https://kaizenalife.com").replace(/\/$/, "");

/** The keys, or null when linking is not set up (a malformed key is logged, and counts as not set up). */
export function linkKeys(): ReturnType<typeof kaizenLifeLinkKeys> {
  try {
    return kaizenLifeLinkKeys();
  } catch (error) {
    log("error", "kaizen_life.keys_invalid", {}, error);
    return null;
  }
}

export const linkingOn = () => linkKeys() !== null;

const LINK_ROW = z.object({ life_user_id: col.uuid, how: z.enum(["identity", "email", "backfill"]), linked_at: col.timestamp });
const toLink = (row: z.output<typeof LINK_ROW>): LifeLink => ({ lifeUserId: row.life_user_id, how: row.how, linkedAt: row.linked_at });

/** The account's live link to Kaizen Life, or null. */
export async function lifeLinkOf(accountId: string): Promise<LifeLink | null> {
  const row = await typedRow(
    LINK_ROW,
    sql`select life_user_id, how, linked_at from commerce.kaizen_life_accounts where account_id = ${accountId}::uuid and unlinked_at is null`,
  );
  return row ? toLink(row) : null;
}

/** Kaizen Life's Today, for an account linked to it (the account menu's way back, 3.6); null when not linked or never readable. */
export async function kaizenLifeAppUrl(accountId: string): Promise<string | null> {
  try {
    return (await lifeLinkOf(accountId)) ? `${lifeUrl()}/app/today` : null;
  } catch (error) {
    log("warn", "kaizen_life.menu_read_failed", {}, error);
    return null;
  }
}

/** The account a live link joins to this Kaizen Life user, or null. */
export async function accountOfLifeUser(lifeUserId: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ account_id: col.uuid }),
    sql`select l.account_id from commerce.kaizen_life_accounts l
        join commerce.accounts a on a.id = l.account_id and a.disabled_at is null
        where l.life_user_id = ${lifeUserId}::uuid and l.unlinked_at is null`,
  );
  return row?.account_id ?? null;
}

/** Whether the account was ever linked: live, or undone by the person (an undone link is never made again by itself). */
async function everLinked(accountId: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ one: col.int }),
    sql`select 1 as one from commerce.kaizen_life_accounts where account_id = ${accountId}::uuid limit 1`,
  );
  return row !== null;
}

/**
 * An account whose email is proved, by this email: one not disabled that has signed in at least once (a sign-in link, a password set
 * through our own confirmation, or an invitation all prove the address). Compared as both apps compare emails.
 */
export async function provedAccountByEmail(email: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.accounts
        where lower(email) = ${linkEmail(email)} and auth_user_id is not null and disabled_at is null
        limit 1`,
  );
  return row?.id ?? null;
}

/** The account a Supabase Auth user signs in as (a sign-in with Kaizena Flow, seen from Kaizen Life). */
export async function accountOfAuthUser(authUserId: string): Promise<string | null> {
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.accounts where auth_user_id = ${authUserId}::uuid and disabled_at is null`,
  );
  return row?.id ?? null;
}

/**
 * Links an account to a Kaizen Life user, by the rules: one live link each; a pair the person undid is linked again only by their
 * own sign-in with the other app (`identity`); a disabled account never. Two linking at once meet the unique indexes, and the
 * one that loses reads what the other made.
 */
export async function linkAccounts(accountId: string, lifeUserId: string, how: LinkHow): Promise<LinkOutcome> {
  const account = await typedRow(
    z.object({ id: col.uuid }),
    sql`select id from commerce.accounts where id = ${accountId}::uuid and disabled_at is null`,
  );
  if (!account) return { kind: "refused", reason: "no_account" };
  const existing = await typedRow(
    z.object({ account_id: col.uuid, life_user_id: col.uuid, how: LINK_ROW.shape.how, linked_at: col.timestamp }),
    sql`select account_id, life_user_id, how, linked_at from commerce.kaizen_life_accounts
        where (account_id = ${accountId}::uuid or life_user_id = ${lifeUserId}::uuid) and unlinked_at is null
        order by (account_id = ${accountId}::uuid and life_user_id = ${lifeUserId}::uuid) desc
        limit 1`,
  );
  if (existing) {
    return existing.account_id === accountId && existing.life_user_id === lifeUserId
      ? { kind: "already", link: toLink(existing) }
      : { kind: "refused", reason: "taken" };
  }
  const undone = await typedRow(
    z.object({ unlinked_at: col.timestamp, unlinked_from: col.text }),
    sql`select unlinked_at, unlinked_from from commerce.kaizen_life_accounts
        where account_id = ${accountId}::uuid and life_user_id = ${lifeUserId}::uuid and unlinked_at is not null`,
  );
  if (undone && how !== "identity") return { kind: "refused", reason: "undone" };
  try {
    const row = undone
      ? await typedRow(
          LINK_ROW,
          sql`update commerce.kaizen_life_accounts
                 set unlinked_at = null, unlinked_from = null, how = ${how}, linked_at = now()
               where account_id = ${accountId}::uuid and life_user_id = ${lifeUserId}::uuid and unlinked_at is not null
              returning life_user_id, how, linked_at`,
        )
      : await typedRow(
          LINK_ROW,
          sql`insert into commerce.kaizen_life_accounts (account_id, life_user_id, how)
              values (${accountId}::uuid, ${lifeUserId}::uuid, ${how})
              returning life_user_id, how, linked_at`,
        );
    if (!row) return { kind: "refused", reason: "taken" };
    await audit(accountId, null, "account.kaizen_life_linked", { how });
    return { kind: "linked", link: toLink(row), revived: undone ? { unlinkedAt: undone.unlinked_at, unlinkedFrom: undone.unlinked_from } : null };
  } catch (error) {
    // Another request linked one of the two first (a unique index): what it made decides.
    if (!isUniqueViolation(error)) throw error;
    const now = await lifeLinkOf(accountId);
    return now?.lifeUserId === lifeUserId ? { kind: "already", link: now } : { kind: "refused", reason: "taken" };
  }
}

const isUniqueViolation = (error: unknown) => {
  const code = (error as { code?: unknown; cause?: { code?: unknown } })?.code ?? (error as { cause?: { code?: unknown } })?.cause?.code;
  return code === "23505";
};

/** Puts back a link Kaizen Life did not take: a new one goes, a revived one is undone again as it was. */
async function takeBack(accountId: string, outcome: Extract<LinkOutcome, { kind: "linked" }>): Promise<void> {
  if (outcome.revived) {
    await db().execute(sql`
      update commerce.kaizen_life_accounts
         set unlinked_at = ${outcome.revived.unlinkedAt}::timestamptz, unlinked_from = ${outcome.revived.unlinkedFrom}
       where account_id = ${accountId}::uuid and life_user_id = ${outcome.link.lifeUserId}::uuid and unlinked_at is null
    `);
  } else {
    await db().execute(sql`
      delete from commerce.kaizen_life_accounts
       where account_id = ${accountId}::uuid and life_user_id = ${outcome.link.lifeUserId}::uuid and unlinked_at is null
    `);
  }
  log("warn", "kaizen_life.link_taken_back", { accountId });
}

/** Undoes the account's live link (the person's choice, in Flow or in Kaizen Life); the Kaizen Life user it joined, or null. */
export async function unlinkAccount(accountId: string, from: "flow" | "life"): Promise<string | null> {
  const row = await typedRow(
    z.object({ life_user_id: col.uuid }),
    sql`update commerce.kaizen_life_accounts set unlinked_at = now(), unlinked_from = ${from}
        where account_id = ${accountId}::uuid and unlinked_at is null
        returning life_user_id`,
  );
  if (!row) return null;
  await audit(accountId, null, "account.kaizen_life_unlinked", { from });
  return row.life_user_id;
}

/** Takes a signed request's `jti` once: false if it was taken before. Expired ones are cleared on the way. */
export async function takeJti(jti: string, expiresAt: Date): Promise<boolean> {
  await db().execute(sql`delete from commerce.kaizen_life_jtis where expires_at < now() - interval '5 minutes'`);
  const row = await typedRow(
    z.object({ jti: col.text }),
    sql`insert into commerce.kaizen_life_jtis (jti, expires_at) values (${jti}, ${expiresAt.toISOString()}::timestamptz)
        on conflict (jti) do nothing returning jti`,
  );
  return row !== null;
}

/** Asks Kaizen Life (a signed POST to one of its doors); the answer, or null on any failure (logged without the body). */
export async function askLife(door: keyof typeof LIFE_DOORS, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<unknown> {
  const keys = linkKeys();
  if (!keys) return null;
  const path = LIFE_DOORS[door];
  const text = JSON.stringify(body);
  try {
    const token = signLinkRequest({ issuer: FLOW_ISSUER, audience: LIFE_ISSUER, path, body: text, privateKeyPem: keys.privateKey });
    const response = await fetcher(`${lifeUrl()}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: text,
      redirect: "error",
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
    if (!response.ok) {
      log("warn", "kaizen_life.ask_failed", { door, status: response.status });
      return null;
    }
    return await response.json();
  } catch (error) {
    log("warn", "kaizen_life.ask_failed", { door }, error);
    return null;
  }
}

/** Links, then writes Kaizen Life's copy in the same call; a link Kaizen Life did not take is taken back. Tells the person once. */
export async function linkAndTell(accountId: string, lifeUserId: string, how: LinkHow, fetcher: typeof fetch = fetch): Promise<LinkOutcome> {
  const outcome = await linkAccounts(accountId, lifeUserId, how);
  if (outcome.kind !== "linked") return outcome;
  const answer = z.object({ linked: z.literal(true) }).safeParse(await askLife("link", { lifeUserId, flowAccountId: accountId, how }, fetcher));
  if (!answer.success) {
    await takeBack(accountId, outcome);
    return { kind: "refused", reason: "life" };
  }
  await sendKaizenLifeLinkedEmail(accountId, how);
  return outcome;
}

/**
 * After the person proved their email here (a sign-in, a confirmed sign-up): links the account to the Kaizen Life user with the same
 * verified email, if Kaizen Life has one and the account was never linked. Never throws; null when there was nothing to do.
 */
export async function offerLinkByEmail(accountId: string, email: string, fetcher: typeof fetch = fetch): Promise<LinkOutcome | null> {
  try {
    if (!linkingOn() || (await everLinked(accountId))) return null;
    const answer = z.object({ lifeUserId: z.uuid().nullable() }).safeParse(await askLife("lookup", { email: linkEmail(email) }, fetcher));
    if (!answer.success || !answer.data.lifeUserId) return null;
    return await linkAndTell(accountId, answer.data.lifeUserId, "email", fetcher);
  } catch (error) {
    log("error", "kaizen_life.offer_failed", { accountId }, error);
    return null;
  }
}

/** The person signed in with Kaizen Life: that sign-in proves both accounts are theirs, so they are linked (or linked again). */
export async function linkBySignIn(accountId: string, lifeUserId: string, fetcher: typeof fetch = fetch): Promise<LinkOutcome | null> {
  try {
    if (!linkingOn()) return null;
    return await linkAndTell(accountId, lifeUserId, "identity", fetcher);
  } catch (error) {
    log("error", "kaizen_life.sign_in_link_failed", { accountId }, error);
    return null;
  }
}

/** The person unlinks in Kaizena Flow: undone here, and Kaizen Life told so its copy goes too (its failure never keeps the link). */
export async function unlinkFromFlow(accountId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const lifeUserId = await unlinkAccount(accountId, "flow");
  if (!lifeUserId) return false;
  const told = z.object({ ok: z.literal(true) }).safeParse(await askLife("unlink", { lifeUserId }, fetcher));
  if (!told.success) log("warn", "kaizen_life.unlink_not_told", { accountId });
  return true;
}
