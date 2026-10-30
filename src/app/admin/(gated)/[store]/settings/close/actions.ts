"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { signedInRecently } from "@/server/auth";
import { createClient } from "@/lib/supabase/server";
import { NO_ACCESS, checkOwnerRole } from "@/server/permissions";
import { closeStore, reopenStore } from "@/server/store-closure";

const here = (slug: string) => `/admin/${slug}/settings/close`;

/** The server's English answers, in the owner's language where the catalogue knows them (D312 A8). */
const said = (adminLocale: string | null | undefined, problems: string[]) => {
  const map = adminText(adminLangOf(adminLocale), "settings").close.problems;
  return problems.map((p) => map[p] ?? p);
};

/** Closing a store is the owner's, after a fresh sign-in and the store's address typed in (D171). */
export async function closeStoreAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (!(await signedInRecently())) return { status: "error", messages: [adminText(adminLangOf(member.account.adminLocale), "settings").close.signInAgainFirst] };
  const result = await closeStore(member.account, member.store.id, { by: "owner", typed: String(form.get("address") ?? "") });
  if (!result.ok) return { status: "error", messages: said(member.account.adminLocale, result.problems) };
  redirect(here(storeSlug));
}

/** Reopening is the owner's for thirty days after closing (the platform's later). */
export async function reopenStoreAction(storeSlug: string, _state: FormState, _form: FormData): Promise<FormState> {
  void _state;
  void _form;
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await reopenStore(member.account, member.store.id, { by: "owner" });
  if (!result.ok) return { status: "error", messages: said(member.account.adminLocale, result.problems) };
  redirect(`/admin/${storeSlug}`);
}

/** Signs the owner out and back in, so the closing has a sign-in from the last ten minutes. */
export async function signInAgainAction(storeSlug: string): Promise<void> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) redirect("/admin");
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect(`/admin/sign-in?next=${encodeURIComponent(here(storeSlug))}`);
  }
}
