import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db/client";

import { afterAnswer } from "./after-answer";
import { audit, linkAccount, setFirstAdminLang } from "./auth";
import { offerLinkByEmail } from "./kaizen-life-accounts";

export type Admission = "admitted" | "no-access";

/**
 * After Supabase has verified a sign-in link: admit the user only if their
 * email belongs to an active account, linking the Supabase user on first
 * sign-in. Anyone else is signed straight out again.
 */
export async function admit(supabase: SupabaseClient, user: User): Promise<Admission> {
  const account = user.email ? await linkAccount(user.id, user.email) : null;
  if (!account) {
    await supabase.auth.signOut();
    return "no-access";
  }
  // The two-step mirror decides when the gate may skip its Auth call (bloat review step 2.33), so it is set right from the Auth
  // SERVER's own list of factors at every sign-in: never from `user` or the session cookie's copy. Unknown fails closed.
  if (!(await reconcileMirror(supabase, account.id))) {
    await supabase.auth.signOut();
    return "no-access";
  }
  await audit(account.id, null, "account.signed_in");
  // The address is proved again: an account never linked to Kaizen Life is linked to the user there with the same verified email
  // (docs/life-work-summary.md 3.3), after the answer, so signing in never waits for Kaizen Life.
  afterAnswer(() => offerLinkByEmail(account.id, account.email));
  // The admin's language at a first sign-in is the browser's (D312 A0); a choice made since stays.
  await setFirstAdminLang(account.id, (await headers()).get("accept-language"));
  return "admitted";
}

/** Sets `two_step_since` from `getUser()`'s answer; false when the Auth server could not be asked or the write failed. */
async function reconcileMirror(supabase: SupabaseClient, accountId: string): Promise<boolean> {
  try {
    const { data: fresh, error } = await supabase.auth.getUser();
    if (error || !fresh?.user) return false;
    const verified = (fresh.user.factors ?? []).some((f) => f.status === "verified");
    if (verified) await db().execute(sql`update commerce.accounts set two_step_since = coalesce(two_step_since, now()) where id = ${accountId}::uuid`);
    else await db().execute(sql`update commerce.accounts set two_step_since = null where id = ${accountId}::uuid and two_step_since is not null`);
    return true;
  } catch {
    return false;
  }
}
