"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { REFERRAL_COOKIE, referralCodeFor } from "@/lib/referrals";
import { designChoice } from "@/lib/design-presets";
import { starterChoice } from "@/lib/store-starters";
import { createAccessRequest } from "@/server/platform";

const input = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: z.email("Enter a valid email address."),
  storeName: z.string().trim().min(1, "Enter a name for your store.").max(80),
  message: z.string().trim().max(1000, "Keep the message under 1,000 characters."),
});

const RECEIVED =
  "Thanks! We have your request. When your store is ready you will get an email with a link to sign in.";

/**
 * Records a request to join the beta. The answer is the same whether or not
 * this email has asked before, so the form reveals nothing about who has.
 */
export async function requestAccess(_state: FormState, formData: FormData): Promise<FormState> {
  // A field people never see; bots fill it in.
  if (String(formData.get("website") ?? "") !== "") return { status: "ok", messages: [RECEIVED] };

  const parsed = input.safeParse({
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
    // The store template (D175) and design profile (D176) chosen: each kept only when it is a published one, checked inside.
    await createAccessRequest({
      ...parsed.data,
      referralCode,
      starterId: starterChoice(formData.get("starter")),
      designPresetId: designChoice(formData.get("design")),
    });
  } catch {
    return { status: "error", messages: ["Your request could not be saved. Please try again."] };
  }
  return { status: "ok", messages: [RECEIVED] };
}
