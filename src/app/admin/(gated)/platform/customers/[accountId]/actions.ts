"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { resetTwoStep } from "@/server/two-step";

/**
 * A platform admin takes a lost second step away from an account (wave 1, 1f, docs/wave-1-trust.md 2.6): its factors and recovery codes go, the
 * person is emailed, and they are held at setting it up next time. Audit-logged for the platform and for each of the person's stores. A platform
 * admin cannot reset their own here: Your account is the way, and another platform admin the fallback.
 */
export async function resetTwoStepAction(accountId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!z.uuid().safeParse(accountId).success) return { status: "error", messages: ["Unknown account."] };
  if (formData.get("confirm") !== "on") return { status: "error", messages: ["Tick the box to say you have checked that it is the person."] };
  const result = await resetTwoStep(admin, accountId);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  refresh();
  return { status: "ok", messages: ["Their two-step sign-in was removed and they have been emailed. They set it up again when they next sign in."] };
}
