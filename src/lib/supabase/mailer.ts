import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";

/**
 * Sends a sign-in link to someone else (such as a newly approved store
 * owner). Uses a client with no session and no cookies, so nothing is written
 * to the sender's browser. The link works in any browser because the email
 * template points at /auth/confirm with a token hash (see README).
 */
export async function emailSignInLink(email: string, origin: string, locale: string | null = null): Promise<boolean> {
  try {
    const env = publicEnv();
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // The person's language (D312 P6) as user data, which Supabase's email template can read as `{{ .Data.locale }}` for a new user.
      options: { emailRedirectTo: `${origin}/admin`, shouldCreateUser: true, ...(locale ? { data: { locale } } : {}) },
    });
    return !error;
  } catch {
    return false;
  }
}
