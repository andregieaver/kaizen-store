import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { headers } from "next/headers";

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
  await audit(account.id, null, "account.signed_in");
  // The address is proved again: an account never linked to Kaizen Life is linked to the user there with the same verified email
  // (docs/life-work-summary.md 3.3), after the answer, so signing in never waits for Kaizen Life.
  afterAnswer(() => offerLinkByEmail(account.id, account.email));
  // The admin's language at a first sign-in is the browser's (D312 A0); a choice made since stays.
  await setFirstAdminLang(account.id, (await headers()).get("accept-language"));
  return "admitted";
}
