"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { BROADCAST_AUDIENCES, type BroadcastSuggestion } from "@/lib/broadcasts";
import {
  audienceCount,
  deleteBroadcast,
  runBroadcasts,
  saveBroadcast,
  scheduleBroadcast,
  sendTestBroadcast,
  startBroadcast,
  stopBroadcast,
  suggestBroadcast,
  unscheduleBroadcast,
} from "@/server/broadcasts";
import type { UploadResult } from "@/server/media";
import { uploadToLibrary } from "@/server/media-library";
import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
import { storeById } from "@/server/shopper-emails";

/**
 * Broadcasts (D297, docs/wave-5-marketing.md 5): every action here changes or sends one, so each asks `marketing:write`. The store is the bound
 * first argument; ids are checked before anything is read.
 */

type Problem = { ok: false; problem: string };
const uuid = z.uuid();

async function writer(storeSlug: string) {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return null;
  const store = await storeById(member.store.id);
  return store ? { member, store } : null;
}

/** Saves a draft (a new one opens on its own page). */
export async function saveBroadcastAction(storeSlug: string, id: string | null, input: unknown): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  if (id !== null && !uuid.safeParse(id).success) return { ok: false, problem: "Unknown broadcast." };
  const result = await saveBroadcast(who.store, who.member.account.id, id, input);
  if (!result.ok) return result;
  if (id === null) redirect(`/admin/${who.member.store.slug}/broadcasts/${result.id}`);
  refresh();
  return { ok: true };
}

/** How many it would go to now: numbers only. */
export async function audienceCountAction(storeSlug: string, audience: string, segmentId: string | null): Promise<Problem | { ok: true; people: number }> {
  const who = await writer(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  const kind = z.enum(BROADCAST_AUDIENCES).safeParse(audience);
  if (!kind.success || (segmentId !== null && !uuid.safeParse(segmentId).success)) return { ok: false, problem: "Choose who it is for." };
  if (kind.data === "segment" && !segmentId) return { ok: false, problem: "Choose a segment." };
  return audienceCount(who.store, kind.data, kind.data === "segment" ? segmentId : null);
}

export async function sendTestAction(storeSlug: string, id: string, locale: string): Promise<Problem | { ok: true; to: string }> {
  const who = await writer(storeSlug);
  if (!who || !uuid.safeParse(id).success) return { ok: false, problem: NO_ACCESS };
  if (!who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: "Choose one of the store's languages." };
  const outcome = await sendTestBroadcast(who.store.id, who.member.account.email, id, locale);
  if (outcome === "empty") return { ok: false, problem: "Save a subject and something to say in that language first." };
  if (outcome === "failed") return { ok: false, problem: "The test could not be sent. Try again." };
  return { ok: true, to: who.member.account.email };
}

export async function startBroadcastAction(storeSlug: string, id: string): Promise<Problem | { ok: true; recipients: number }> {
  const who = await writer(storeSlug);
  if (!who || !uuid.safeParse(id).success) return { ok: false, problem: NO_ACCESS };
  const result = await startBroadcast(who.store.id, who.member.account.id, id);
  if (!result.ok) return result;
  // The first batches go at once; the every-minute job carries on with the rest.
  after(() => runBroadcasts({ only: id }).then(() => undefined));
  refresh();
  return result;
}

export async function scheduleBroadcastAction(storeSlug: string, id: string, when: string): Promise<Problem | { ok: true }> {
  const who = await writer(storeSlug);
  if (!who || !uuid.safeParse(id).success) return { ok: false, problem: NO_ACCESS };
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return { ok: false, problem: "Choose a date and time." };
  const result = await scheduleBroadcast(who.store.id, who.member.account.id, id, at);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function unscheduleBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!uuid.safeParse(id).success) return;
  await unscheduleBroadcast(member.store.id, member.account.id, id);
  refresh();
}

export async function stopBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!uuid.safeParse(id).success) return;
  await stopBroadcast(member.store.id, member.account.id, id);
  refresh();
}

export async function deleteBroadcastAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!uuid.safeParse(id).success) return;
  await deleteBroadcast(member.store.id, member.account.id, id);
  redirect(`/admin/${member.store.slug}/broadcasts`);
}

/** A suggestion from the AI for the editor; nothing is saved. */
export async function suggestBroadcastAction(storeSlug: string, brief: string, locale: string): Promise<Problem | { ok: true; suggestion: BroadcastSuggestion }> {
  const who = await writer(storeSlug);
  if (!who) return { ok: false, problem: NO_ACCESS };
  if (typeof brief !== "string" || typeof locale !== "string" || !who.store.localization.keptLocales.includes(locale)) return { ok: false, problem: "Choose one of the store's languages." };
  return suggestBroadcast(who.store, who.member.account.id, brief, locale);
}

/** A picture for an email, kept in the store's media library (D88); the browser sends a JPEG. */
export async function uploadBroadcastPictureAction(storeSlug: string, data: FormData): Promise<UploadResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  return uploadToLibrary({ storeId: member.store.id, accountId: member.account.id }, data);
}
