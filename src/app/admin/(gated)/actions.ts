"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { methodsForMarket } from "@/lib/payment-methods";
import { createClient } from "@/lib/supabase/server";
import { requireMember, type Membership } from "@/server/auth";
import {
  disableStaff,
  inviteStaff,
  saveStripeCredentials,
  setPaymentMethods,
  setStripeProvider,
  type SaveResult,
} from "@/server/settings";

// Every action takes the store's slug as its first (bound) argument and
// re-checks the signed-in account's access to that store.

const mode = z.enum(["test", "live"]);

async function asOwner(storeSlug: string): Promise<Membership | FormState> {
  const member = await requireMember(storeSlug);
  return member.role === "owner"
    ? member
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
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
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
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const parsedMode = mode.safeParse(formData.get("activeMode"));
  if (!parsedMode.success) return { status: "error", messages: ["Unknown mode."] };
  return toState(
    await setStripeProvider(owner, formData.get("enabled") === "on", parsedMode.data),
  );
}

export async function setPaymentMethodsAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const enabled: Record<string, string[]> = {};
  for (const { code } of member.store.markets) {
    enabled[code] = methodsForMarket(code)
      .map((method) => method.id)
      .filter((id) => formData.get(`method:${code}:${id}`) === "on");
  }
  return toState(await setPaymentMethods(member, enabled));
}

export async function inviteStaffAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
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
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const id = z.uuid().safeParse(formData.get("accountId"));
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
