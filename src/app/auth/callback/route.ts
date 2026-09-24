import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { audit, linkAccount } from "@/server/auth";

/**
 * Where the magic link lands. Exchanges the one-time code for a session, then
 * admits the user only if their email belongs to an active account.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!code) return to("/admin/sign-in?error=link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) return to("/admin/sign-in?error=link");

  const account = await linkAccount(data.user.id, data.user.email);
  if (!account) {
    await supabase.auth.signOut();
    return to("/admin/sign-in?error=no-access");
  }
  await audit(account.id, null, "account.signed_in");
  return to("/admin");
}
