"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { MARKET_SLUGS, MARKETS } from "@/lib/markets";
import { methodsForMarket } from "@/lib/payment-methods";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, type Staff } from "@/server/auth";
import {
  disableStaff,
  inviteStaff,
  saveStripeCredentials,
  setPaymentMethods,
  setStripeProvider,
  type SaveResult,
} from "@/server/settings";

const mode = z.enum(["test", "live"]);

async function asOwner(): Promise<Staff | FormState> {
  const staff = await requireStaff();
  return staff.role === "owner"
    ? staff
    : { status: "error", messages: ["Only an owner can change this."] };
}

function toState(result: SaveResult, success?: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: success ? [success] : [] };
}

const field = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim() || undefined;

export async function saveStripeCredentialsAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner();
  if (!("id" in owner)) return owner;
  const parsedMode = mode.safeParse(formData.get("mode"));
  if (!parsedMode.success) return { status: "error", messages: ["Unknown mode."] };
  return toState(
    await saveStripeCredentials(owner, parsedMode.data, {
      publishableKey: field(formData, "publishableKey"),
      secretKey: field(formData, "secretKey"),
      webhookSecret: field(formData, "webhookSecret"),
    }),
    `Saved the ${parsedMode.data} keys.`,
  );
}

export async function setStripeProviderAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner();
  if (!("id" in owner)) return owner;
  const parsedMode = mode.safeParse(formData.get("activeMode"));
  if (!parsedMode.success) return { status: "error", messages: ["Unknown mode."] };
  return toState(
    await setStripeProvider(owner, formData.get("enabled") === "on", parsedMode.data),
  );
}

export async function setPaymentMethodsAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff();
  const enabled: Record<string, string[]> = {};
  for (const slug of MARKET_SLUGS) {
    const code = MARKETS[slug].code;
    enabled[code] = methodsForMarket(code)
      .map((method) => method.id)
      .filter((id) => formData.get(`method:${code}:${id}`) === "on");
  }
  return toState(await setPaymentMethods(staff, enabled));
}

export async function inviteStaffAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner();
  if (!("id" in owner)) return owner;
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());
  const role = z.enum(["owner", "admin"]).safeParse(formData.get("role"));
  if (!email.success || !role.success) {
    return { status: "error", messages: ["Enter a valid email and role."] };
  }
  return toState(
    await inviteStaff(owner, email.data, role.data),
    `${email.data} can now sign in at /admin/sign-in.`,
  );
}

export async function disableStaffAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner();
  if (!("id" in owner)) return owner;
  const id = z.uuid().safeParse(formData.get("staffId"));
  if (!id.success) return { status: "error", messages: ["Unknown staff member."] };
  return toState(await disableStaff(owner, id.data), "Access removed.");
}

export async function signOut(): Promise<void> {
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect("/admin/sign-in");
  }
}
