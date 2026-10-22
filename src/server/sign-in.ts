import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { audit, linkAccount, setFirstAdminLang } from "./auth";

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
  // The admin's language at a first sign-in is the browser's (D312 A0); a choice made since stays.
  await setFirstAdminLang(account.id, (await headers()).get("accept-language"));
  return "admitted";
}
