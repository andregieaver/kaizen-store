import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { safeNext } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { admit } from "@/server/sign-in";

const TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery"];

/**
 * Where a sign-in link lands when the email template sends a token hash
 * (`/auth/confirm?token_hash={{ .TokenHash }}&type=email`). Unlike the PKCE
 * callback, this works in any browser, so an invited owner can open the
 * link wherever they read their email. A password reset link
 * (`type=recovery`) opens Your account, where the new password is chosen.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!tokenHash || !type || !TYPES.includes(type)) return to("/admin/sign-in?error=link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) return to("/admin/sign-in?error=link");

  return (await admit(supabase, data.user)) === "admitted"
    ? to(safeNext(url.searchParams.get("next"), type === "recovery" ? "/admin/account" : "/admin"))
    : to("/admin/sign-in?error=no-access");
}
