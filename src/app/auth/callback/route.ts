import { type NextRequest, NextResponse } from "next/server";

import { afterFirstStep } from "@/lib/sign-in-redirect";
import { createClient } from "@/lib/supabase/server";
import { admitFromKaizenLife } from "@/server/kaizen-life";
import { admit } from "@/server/sign-in";

/**
 * Where a PKCE sign-in link lands (the link must be opened in the browser
 * that asked for it). Links sent with a token hash land on /auth/confirm.
 * `next` is where to go afterwards, e.g. Your account after a password reset.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (!code) return to("/admin/sign-in?error=link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return to("/admin/sign-in?error=link");

  // Signed in with Kaizen Life (D95): owners only; someone without an account may ask for a store.
  if (url.searchParams.get("via") === "kaizen-life") {
    const admission = await admitFromKaizenLife(supabase, data.user);
    if (admission.kind === "admitted") return to(afterFirstStep(data.user, url.searchParams.get("next")));
    if (admission.kind === "owners-only") return to("/admin/sign-in?error=owners-only");
    const ask = new URLSearchParams({ via: "kaizen-life", email: admission.email, name: admission.name });
    return to(`/sign-up?${ask.toString()}`);
  }

  return (await admit(supabase, data.user)) === "admitted"
    ? to(afterFirstStep(data.user, url.searchParams.get("next")))
    : to("/admin/sign-in?error=no-access");
}
