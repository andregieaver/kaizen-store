"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Keeps the admin session fresh while a tab is open. The browser client
 * refreshes the access token before it expires and writes the new cookies,
 * so server rendering keeps seeing a valid session.
 */
export function SessionKeeper() {
  useEffect(() => {
    try {
      const { data } = createClient().auth.onAuthStateChange(() => {});
      return () => data.subscription.unsubscribe();
    } catch {
      return undefined;
    }
  }, []);
  return null;
}

const RECOVERY_KEY = "kaizen-admin-recovery";

/**
 * Shown when the server finds no valid staff session. If the access token
 * has merely expired, refresh it and reload; otherwise go to sign-in.
 */
export function SessionRecovery() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let client;
      try {
        client = createClient();
      } catch {
        router.replace("/admin/sign-in");
        return;
      }
      const { data } = await client.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace("/admin/sign-in");
        return;
      }
      // There is a session, yet the server refused it. Refresh once; if that
      // was already tried moments ago, this account simply has no access.
      const last = Number(sessionStorage.getItem(RECOVERY_KEY) ?? 0);
      if (Date.now() - last < 15_000) {
        sessionStorage.removeItem(RECOVERY_KEY);
        router.replace("/admin/sign-in?error=no-access");
        return;
      }
      sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
      router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return <p className="p-8 text-sm text-muted">Checking your session …</p>;
}
