import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { admit } from "@/server/sign-in";

/**
 * Where a PKCE sign-in link lands (the link must be opened in the browser
 * that asked for it). Links sent with a token hash land on /auth/confirm.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!code) return to("/admin/sign-in?error=link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return to("/admin/sign-in?error=link");

  return (await admit(supabase, data.user)) === "admitted"
    ? to("/admin")
    : to("/admin/sign-in?error=no-access");
}
