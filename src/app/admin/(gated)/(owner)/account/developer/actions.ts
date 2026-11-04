"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { readAppForm } from "@/lib/apps";
import { requireAccount } from "@/server/auth";
import { becomeDeveloper, createApp, renewAppSecret, updateApp, type Shown } from "@/server/developer-apps";

/** What the app form hears back: its problems by field, or what to show once (a new app's secrets). */
export type AppAnswer = { ok: true; id: string; shown?: Shown } | { ok: false; problems: Record<string, string> };

/** Developer mode (D441): the account accepts the developer terms; the box must be ticked. */
export async function becomeDeveloperAction(form: FormData): Promise<void> {
  const account = await requireAccount();
  if (form.get("terms") !== "on") redirect("/admin/account/developer?problem=terms");
  await becomeDeveloper(account);
  redirect("/admin/account/developer");
}

/** A new app: its secrets come back once, to be shown once. */
export async function createAppAction(form: FormData): Promise<AppAnswer> {
  const account = await requireAccount();
  const read = readAppForm(form);
  if (!read.ok) return read;
  const made = await createApp(account, read.app);
  if (!made.ok) return made;
  refresh();
  return { ok: true, id: made.id, shown: made.shown };
}

/** The developer changes their app. */
export async function updateAppAction(appId: string, form: FormData): Promise<AppAnswer> {
  const account = await requireAccount();
  const read = readAppForm(form);
  if (!read.ok) return read;
  const saved = await updateApp(account, appId, read.app);
  if (!saved.ok) return saved;
  refresh();
  return { ok: true, id: saved.id };
}

/** A new client or events secret, shown once. */
export async function renewAppSecretAction(appId: string, which: "client" | "webhook"): Promise<AppAnswer> {
  const account = await requireAccount();
  const renewed = await renewAppSecret(account, appId, which === "webhook" ? "webhook" : "client");
  if (!renewed.ok) return renewed;
  return { ok: true, id: renewed.id, shown: renewed.shown };
}
