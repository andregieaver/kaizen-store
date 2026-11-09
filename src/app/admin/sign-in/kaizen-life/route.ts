import { connection, NextResponse } from "next/server";

import { safeNext } from "@/lib/password";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";
import { KAIZEN_LIFE_PROVIDER, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { log } from "@/server/log";

/**
 * The one door from Kaizen Life into the admin (docs/life-work-summary.md 3.5): every link in Kaizen Life's Work summary opens
 * `/admin/sign-in/kaizen-life?next=…`. Someone signed in goes straight to `next` (held to the admin by `safeNext()`); someone held
 * at their second step goes to it, `next` kept; someone signed out signs in with Kaizen Life and comes back to `next` (silent once
 * they have let Kaizena Flow in before, as Kaizen Life's consent page skips a client approved already). Someone with no account
 * there lands on the sign-up, filled in from Kaizen Life (the callback, D95). Without Sign in with Kaizen Life, the sign-in page,
 * `next` kept.
 */
export async function GET(request: Request): Promise<Response> {
  await connection();
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const go = (path: string) => NextResponse.redirect(new URL(path, siteUrl()), 303);
  const signInPage = `/admin/sign-in?next=${encodeURIComponent(next)}`;
  if (await getAccount()) return go(next);
  const held = await getAssurance();
  const destination = held ? heldDestination(held.assurance, next) : null;
  if (destination) return go(destination);
  if (!kaizenLifeSignInOn()) return go(signInPage);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: KAIZEN_LIFE_PROVIDER,
      options: {
        redirectTo: `${siteUrl()}/auth/callback?via=kaizen-life&next=${encodeURIComponent(next)}`,
        scopes: "openid email profile",
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) return go(`${signInPage}&error=kaizen-life`);
    return NextResponse.redirect(data.url, 303);
  } catch (error) {
    log("warn", "kaizen_life.door_sign_in_failed", {}, error);
    return go(signInPage);
  }
}
