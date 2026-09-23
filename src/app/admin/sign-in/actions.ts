"use server";

import { headers } from "next/headers";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import { isActiveStaffEmail } from "@/server/auth";

const SENT =
  "If that email has access, a sign-in link is on its way. Open it in this browser; it works once and expires within the hour.";

/**
 * Sends a magic link, but only to active staff. The reply is the same either
 * way, so the form cannot be used to find out who has access.
 */
export async function requestSignInLink(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());
  if (!email.success) {
    return { status: "error", messages: ["Enter a valid email address."] };
  }
  if (!(await isActiveStaffEmail(email.data))) {
    return { status: "ok", messages: [SENT] };
  }

  const origin = (await headers()).get("origin") ?? siteUrl();
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { status: "error", messages: ["Sign-in is not configured on this server."] };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      emailRedirectTo: `${new URL(origin).origin}/auth/callback`,
      shouldCreateUser: true,
    },
  });
  if (error) {
    return {
      status: "error",
      messages: [
        error.status === 429
          ? "Too many sign-in emails. Wait a minute and try again."
          : "The sign-in email could not be sent. Try again shortly.",
      ],
    };
  }
  return { status: "ok", messages: [SENT] };
}
