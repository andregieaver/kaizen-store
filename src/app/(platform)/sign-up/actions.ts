"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { REFERRAL_COOKIE, referralCodeFor } from "@/lib/referrals";
import { designLookChoice } from "@/lib/design-presets";
import { contentForLook } from "@/server/design-presets";
import { createAccessRequest } from "@/server/platform";
import { addressOf } from "@/server/analytics-visits";
import { confirmSelfSignup, selfServeOn, startSelfSignup } from "@/server/self-signup";
import { langOfLocale, type PlatformLang } from "@/lib/platform-lang";
import { platformText, type PlatformMessages } from "@/lib/platform-text";

/** The form's checks, in the words of the language it was sent in (D312). */
function inputIn(errors: PlatformMessages["signUp"]["errors"]) {
  return z.object({
    name: z.string().trim().min(1, errors.name).max(100),
    email: z.email(errors.email),
    storeName: z.string().trim().min(1, errors.storeName).max(80),
    message: z.string().trim().max(1000, errors.message),
  });
}

/** The language the form was sent in: its `locale` field, English for anything else. */
function langOfForm(formData: FormData): PlatformLang {
  return langOfLocale(String(formData.get("locale") ?? "")) ?? "en";
}

/**
 * Records a request to join the beta. The answer is the same whether or not
 * this email has asked before, so the form reveals nothing about who has.
 */
export async function requestAccess(_state: FormState, formData: FormData): Promise<FormState> {
  const lang = langOfForm(formData);
  const w = platformText(lang).signUp;
  // A field people never see; bots fill it in.
  if (String(formData.get("website") ?? "") !== "") return { status: "ok", messages: [w.received] };

  const parsed = inputIn(w.errors).safeParse({
    name: formData.get("name") ?? "",
    email: String(formData.get("email") ?? "").trim(),
    storeName: formData.get("storeName") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", messages: parsed.error.issues.map((issue) => issue.message) };
  }
  // A referral (D131): the code the link put in the form, else the cookie, which only exists when the visitor allowed it.
  // An unknown or blocked code is dropped inside, so nothing here tells the visitor whether it was good.
  const referralCode = referralCodeFor(String(formData.get("ref") ?? ""), (await cookies()).get(REFERRAL_COOKIE)?.value);
  try {
    // The theme and its preset (`docs/theme-showcase-phase-1.md` step 4) chosen, kept only when published (checked inside), and the demo
    // store the look starts a store with (D273): never chosen apart.
    const look = designLookChoice(formData.get("design"));
    const input = {
      ...parsed.data,
      referralCode,
      starterId: await contentForLook(look),
      designPresetId: look?.id ?? null,
      designVariation: look?.variation ?? null,
      lang,
    };
    // Self-serve (D359): the address is confirmed by a link first, and the store is made on the press; the answer is the same either way.
    if (await selfServeOn()) {
      await startSelfSignup(input, addressOf(await headers()) || null);
      return { status: "ok", messages: [w.selfServe.received] };
    }
    await createAccessRequest(input);
  } catch {
    return { status: "error", messages: [w.failed] };
  }
  return { status: "ok", messages: [w.received] };
}

/** The press on the confirmation page (D359): makes the store, or says why not, in the page's language. */
export async function confirmSignup(_state: FormState, formData: FormData): Promise<FormState> {
  const w = platformText(langOfForm(formData)).signUp.selfServe;
  const done = await confirmSelfSignup(String(formData.get("token") ?? ""), { password: String(formData.get("password") ?? "") });
  if (done.ok) return { status: "ok", messages: [(done.password ? w.doneWithPassword : w.done).replaceAll("{store}", done.storeName)] };
  return { status: "error", messages: [w[done.problem]] };
}
