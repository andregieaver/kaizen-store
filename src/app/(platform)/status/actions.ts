"use server";

import type { FormState } from "@/components/admin/action-form";
import { langOfLocale, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { confirmStatusSubscription, subscribeToStatus, unsubscribeFromStatus } from "@/server/status";

const langOf = (form: FormData): PlatformLang => langOfLocale(String(form.get("locale") ?? "")) ?? "en";

/** Asks to hear about incidents (D360): the same answer whether the address was new, waiting or confirmed. */
export async function subscribeStatusAction(_state: FormState, form: FormData): Promise<FormState> {
  const w = platformText(langOf(form)).status;
  if (String(form.get("website") ?? "") !== "") return { status: "ok", messages: [w.subscribed] };
  try {
    const done = await subscribeToStatus(String(form.get("email") ?? ""), langOf(form));
    return done.ok ? { status: "ok", messages: [w.subscribed] } : { status: "error", messages: [w.invalidEmail] };
  } catch {
    return { status: "error", messages: [w.failed] };
  }
}

/** The press on the confirmation page. */
export async function confirmStatusAction(_state: FormState, form: FormData): Promise<FormState> {
  const w = platformText(langOf(form)).status;
  return (await confirmStatusSubscription(String(form.get("token") ?? "")))
    ? { status: "ok", messages: [w.confirmed] }
    : { status: "error", messages: [w.unknownLink] };
}

/** The press on the unsubscribe page. */
export async function unsubscribeStatusAction(_state: FormState, form: FormData): Promise<FormState> {
  const w = platformText(langOf(form)).status;
  return (await unsubscribeFromStatus(String(form.get("token") ?? "")))
    ? { status: "ok", messages: [w.unsubscribed] }
    : { status: "error", messages: [w.unknownLink] };
}
