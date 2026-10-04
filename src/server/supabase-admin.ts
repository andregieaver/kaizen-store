import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";
import { supabaseKeyKind } from "@/lib/supabase-key";

/**
 * Supabase Auth's admin API, for the few things only the server may do for a person: take a second-step factor away from an
 * account (a recovery code used, a platform admin's reset). It needs the secret key (`SUPABASE_SECRET_KEY`, the one the Storage
 * uploads use); the publishable key is refused by name, as `media.ts` does, so the mistake is a sentence and not a failed call.
 * The client keeps no session and refreshes no token: it is a key and nothing else.
 */
export type AdminAuth = SupabaseClient["auth"]["admin"];

export type AdminClient = { ok: true; admin: AdminAuth } | { ok: false; problem: string };

export function adminAuth(): AdminClient {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return { ok: false, problem: "Recovery is not available on this server. Ask a platform admin to reset your two-step." };
  if (supabaseKeyKind(key) === "publishable") {
    console.error("[two-step] SUPABASE_SECRET_KEY holds the publishable key; the admin API refuses it.");
    return { ok: false, problem: "Recovery is not available on this server. Ask a platform admin to reset your two-step." };
  }
  let url: string;
  try {
    url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return { ok: false, problem: "Recovery is not available on this server. Ask a platform admin to reset your two-step." };
  }
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  return { ok: true, admin: client.auth.admin };
}
