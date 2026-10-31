"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { createClient } from "@/lib/supabase/server";
import { eraseOwnAccount } from "@/server/account-erasure";
import { requireAccount, signedInRecently } from "@/server/auth";
import { sameEmail } from "@/lib/email-address";

const HERE = "/admin/account/delete";

/**
 * Deleting one's own account (wave 10 unit P, D377): after a sign-in from the last ten minutes and the account's email typed again, through
 * `eraseOwnAccount()`, which refuses before anything changes when the account cannot go yet. Then the person is signed out.
 */
export async function eraseAccountAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount();
  const w = adminText(adminLangOf(account.adminLocale), "bookings").account.erase;
  if (!(await signedInRecently())) return { status: "error", messages: [w.signInAgainFirst] };
  if (!sameEmail(String(form.get("email") ?? ""), account.email)) return { status: "error", messages: [w.wrongEmail] };
  const done = await eraseOwnAccount(account);
  if (!done.ok) return { status: "error", messages: [done.refusal === "last_owner" && done.stores ? `${w.refusals.last_owner} ${done.stores.join(", ")}` : w.refusals[done.refusal]] };
  try {
    await (await createClient()).auth.signOut();
  } catch {
    // The sign-in user is gone already; the cookie only names it.
  }
  redirect("/admin/sign-in");
}

/** Signs the person out and back in, so the deleting has a sign-in from the last ten minutes. */
export async function signInAgainAction(): Promise<void> {
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect(`/admin/sign-in?next=${encodeURIComponent(HERE)}`);
  }
}
