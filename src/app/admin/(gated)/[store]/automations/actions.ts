"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { AUTOMATION_KINDS, LIFECYCLE_KINDS } from "@/lib/automations";
import { saveAutomation, sendTestAutomation, switchAutomation } from "@/server/automations";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { storeById } from "@/server/shopper-emails";

/**
 * Automations (D298, docs/wave-5-marketing.md 6): every action here changes one or sends a test, so each asks `marketing:write`. The store is the
 * bound first argument; the kind is checked before anything is read.
 */

type Problem = { ok: false; problem: string };

async function writer(storeSlug: string) {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return null;
  const store = await storeById(member.store.id);
  return store ? { member, store } : null;
}

export async function saveAutomationAction(storeSlug: string, kind: string, input: unknown): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  const lifecycle = z.enum(LIFECYCLE_KINDS).safeParse(kind);
  if (!lifecycle.success) return { ok: false, problem: "Unknown automation." };
  const result = await saveAutomation(who.store, who.member.account.id, lifecycle.data, input);
  if (result.ok) refresh();
  return result;
}

export async function switchAutomationAction(storeSlug: string, kind: string, on: boolean): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  const parsed = z.enum(AUTOMATION_KINDS).safeParse(kind);
  if (!parsed.success || typeof on !== "boolean") return { ok: false, problem: "Unknown automation." };
  const result = await switchAutomation(who.store, who.member.account.id, parsed.data, on);
  if (result.ok) refresh();
  return result;
}

export async function testAutomationAction(storeSlug: string, kind: string, locale: string): Promise<Problem | { ok: true; to: string }> {
  const who = await writer(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  const lifecycle = z.enum(LIFECYCLE_KINDS).safeParse(kind);
  if (!lifecycle.success) return { ok: false, problem: "Unknown automation." };
  if (!who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: "Choose one of the store's languages." };
  const outcome = await sendTestAutomation(who.store.id, who.member.account.email, lifecycle.data, locale);
  if (outcome === "empty") return { ok: false, problem: "Save a subject and something to say in that language first." };
  if (outcome === "failed") return { ok: false, problem: "The test could not be sent. Try again." };
  return { ok: true, to: who.member.account.email };
}
