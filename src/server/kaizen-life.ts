import "server-only";

import type { SupabaseClient, User, UserIdentity } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { afterAnswer } from "./after-answer";
import { audit, linkAccount, type Account } from "./auth";
import { lifeLinkOf, linkBySignIn } from "./kaizen-life-accounts";

type Row = Record<string, unknown>;

/**
 * Kaizen Life (D95): kaizenlifetracker.com, Kaizen's personal-life app, on
 * a Supabase project of its own. Each project is the other's OpenID Connect
 * provider (Supabase's OAuth 2.1 server), so a store owner signs in to the
 * admin with their Kaizen Life account and a Kaizen Life user with their
 * store account. Sign-in with Kaizen Life admits an account that owns a
 * store or runs the platform, or one linked to that Kaizen Life user
 * (docs/life-work-summary.md 3.3: the link already proves it is the same
 * person), and nobody else; the sign-in itself links the two.
 */

/** The Kaizen Life provider as set up in the store's Supabase project. */
export const KAIZEN_LIFE_PROVIDER = "custom:kaizen-life" as const;

/** Signing in with Kaizen Life is set up in Supabase (both projects) and switched on here. */
export const kaizenLifeSignInOn = () => process.env.KAIZEN_LIFE_SSO === "on";

/** Whether the account owns a store (active) or runs the platform. */
export async function isOwner(account: Pick<Account, "id" | "platformAdmin">): Promise<boolean> {
  if (account.platformAdmin) return true;
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed'
    where m.account_id = ${account.id}::uuid and m.role = 'owner' and m.disabled_at is null
    limit 1
  `);
  return Boolean(row);
}

export type KaizenLifeAdmission =
  | { kind: "admitted" }
  /** No account uses this email: the person may ask for a store. */
  | { kind: "no-account"; email: string; name: string }
  /** An account that owns no store (staff, a host): not through Kaizen Life. */
  | { kind: "owners-only" };

/**
 * After a sign-in with Kaizen Life: the owner is admitted and linked (by
 * the email Kaizen Life has verified, or the identity linked before);
 * anyone else is signed straight out, told why.
 */
export async function admitFromKaizenLife(supabase: SupabaseClient, user: User): Promise<KaizenLifeAdmission> {
  const identity = user.identities?.find((i) => i.provider === KAIZEN_LIFE_PROVIDER);
  const account = user.email ? await linkAccount(user.id, user.email) : null;
  if (!account) {
    await supabase.auth.signOut();
    const data = (identity?.identity_data ?? {}) as Record<string, unknown>;
    const name = [data.full_name, data.name].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? "";
    return { kind: "no-account", email: user.email ?? "", name };
  }
  const lifeUserId = lifeUserIdOf(identity);
  const linked = lifeUserId !== null && (await lifeLinkOf(account.id))?.lifeUserId === lifeUserId;
  if (!linked && !(await isOwner(account))) {
    await supabase.auth.signOut();
    return { kind: "owners-only" };
  }
  await audit(account.id, null, "account.signed_in", { with: "kaizen-life" });
  // The sign-in proves both accounts are this person's: they are linked (or linked again), after the answer.
  if (lifeUserId) afterAnswer(() => linkBySignIn(account.id, lifeUserId));
  return { kind: "admitted" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Kaizen Life user an identity is (its OpenID subject: Kaizen Life's own user id), or null. */
export function lifeUserIdOf(identity: Pick<UserIdentity, "id" | "identity_data"> | undefined): string | null {
  const data = (identity?.identity_data ?? {}) as Record<string, unknown>;
  const subject = typeof data.sub === "string" ? data.sub : identity?.id;
  return subject && UUID.test(subject) ? subject.toLowerCase() : null;
}

/** The signed-in user's Kaizen Life identity, if linked. */
export async function kaizenLifeIdentity(supabase: SupabaseClient): Promise<UserIdentity | null> {
  const { data } = await supabase.auth.getUserIdentities();
  return data?.identities.find((i) => i.provider === KAIZEN_LIFE_PROVIDER) ?? null;
}
