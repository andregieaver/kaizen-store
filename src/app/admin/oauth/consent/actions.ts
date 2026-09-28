"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { audit, getAccount } from "@/server/auth";
import { isOwner } from "@/server/kaizen-life";

/**
 * The owner's answer on the consent page (D95): Supabase's OAuth server
 * gives the address to send them back to the app that asked, with a code
 * on yes. Only owners may say yes.
 */
export async function decideConsentAction(formData: FormData): Promise<void> {
  const id = String(formData.get("authorization_id") ?? "");
  const approve = formData.get("decision") === "approve";
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(id)) redirect("/admin");
  const account = await getAccount();
  if (!account) redirect(`/admin/sign-in?next=${encodeURIComponent(`/admin/oauth/consent?authorization_id=${id}`)}`);
  if (approve && !(await isOwner(account))) redirect(`/admin/oauth/consent?authorization_id=${id}`);
  const supabase = await createClient();
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) redirect(`/admin/oauth/consent?authorization_id=${id}&error=1`);
  await audit(account.id, null, approve ? "account.oauth_approved" : "account.oauth_denied", {});
  redirect(data.redirect_url);
}
