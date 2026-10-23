"use server";

import { createHash } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { langOfLocale, platformPath } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { startDomainAccount } from "@/server/domain-account";
import { domainsPublic } from "@/server/domain-purchases";

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Starting to buy a domain without a store (D317 4): the email gets a sign-in link to the checkout in the admin, and an account is made
 * for it when there is none. Until Kaizena Flow sells domains on their own, the visitor goes to sign-up with the name kept, as before. The
 * answer is the same for every address.
 */
export async function startDomainCheckout(_state: FormState, form: FormData): Promise<FormState> {
  const lang = langOfLocale(String(form.get("locale") ?? "")) ?? "en";
  const w = platformText(lang).domainStart;
  const domainText = String(form.get("domain") ?? "").trim().toLowerCase();
  const domain = DOMAIN.test(domainText) ? domainText : "";
  if (!(await domainsPublic())) {
    redirect(`${platformPath(lang, "/sign-up")}${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`);
  }
  // A field people never see; bots fill it in.
  if (String(form.get("website") ?? "") !== "") return { status: "ok", messages: [w.sent] };
  const email = z.email().safeParse(String(form.get("email") ?? "").trim());
  if (!email.success) return { status: "error", messages: [w.invalidEmail] };
  const h = await headers();
  const address = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const visitor = createHash("sha256").update(`${address}|${new Date().toISOString().slice(0, 10)}|kaizena-domain-start`).digest("hex").slice(0, 24);
  if (!(await startDomainAccount(email.data, visitor))) return { status: "error", messages: [w.tooMany] };
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { status: "error", messages: [w.notConfigured] };
  }
  const next = `/admin/account/domains/buy${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`;
  const origin = h.get("origin") ? new URL(h.get("origin")!).origin : siteUrl();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true },
  });
  if (error?.status === 429) return { status: "error", messages: [w.tooMany] };
  return { status: "ok", messages: [w.sent] };
}
