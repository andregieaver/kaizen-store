import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { audit, linkStaffAccount } from "@/server/auth";

/**
 * Where the magic link lands. Exchanges the one-time code for a session, then
 * admits the user only if their email belongs to active staff.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!code) return to("/admin/sign-in?error=link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) return to("/admin/sign-in?error=link");

  const staff = await linkStaffAccount(data.user.id, data.user.email);
  if (!staff) {
    await supabase.auth.signOut();
    return to("/admin/sign-in?error=no-access");
  }
  await audit(staff.id, "staff.signed_in");
  return to("/admin");
}
