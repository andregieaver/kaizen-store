"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { cookiesReadable } from "@/lib/browser-access";
import { signInFor } from "@/lib/sign-in-for";
import { AdminWaiting } from "./admin-waiting";
import type { AdminLang } from "@/lib/admin-lang";

/**
 * Keeps the admin session fresh while a tab is open. The browser client
 * refreshes the access token before it expires and writes the new cookies,
 * so server rendering keeps seeing a valid session. The client is loaded once the page is idle (bloat review step 0.9), so it is not in a screen's first scripts.
 */
export function SessionKeeper() {
  useEffect(() => {
    // A template's sandboxed preview frame (D127) cannot read cookies: no session to keep there, and the client's timer would only fail.
    if (!cookiesReadable(document)) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const start = async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        if (cancelled) return;
        const { data } = createClient().auth.onAuthStateChange(() => {});
        unsubscribe = () => data.subscription.unsubscribe();
        if (cancelled) unsubscribe();
      } catch {}
    };
    const useIdle = typeof window.requestIdleCallback === "function";
    const idle = useIdle ? window.requestIdleCallback(() => void start(), { timeout: 2000 }) : window.setTimeout(() => void start(), 2000);
    return () => {
      cancelled = true;
      if (useIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      unsubscribe?.();
    };
  }, []);
  return null;
}

const RECOVERY_KEY = "kaizen-admin-recovery";

/**
 * Shown when the server finds no valid staff session. If the access token
 * has merely expired, refresh it and reload; otherwise go to sign-in, which
 * brings the person back to this page afterwards (`signInFor()`).
 */
export function SessionRecovery({ waiting }: { waiting: Record<AdminLang, string> }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    const signIn = signInFor(`${window.location.pathname}${window.location.search}`);
    (async () => {
      let client;
      try {
        const { createClient } = await import("@/lib/supabase/client");
        client = createClient();
      } catch {
        router.replace(signIn);
        return;
      }
      if (cancelled) return;
      const { data } = await client.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace(signIn);
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
  return <AdminWaiting words={waiting} />;
}
