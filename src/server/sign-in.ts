import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { audit, linkAccount } from "./auth";

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
  await audit(account.id, null, "account.signed_in");
  return "admitted";
}
