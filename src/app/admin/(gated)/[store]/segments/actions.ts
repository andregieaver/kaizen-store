"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { segmentRulesSchema, type SegmentCount } from "@/lib/segments";
import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
import { deleteSegment, evaluateSegment, saveSegment } from "@/server/segments";

export type PreviewResult = ({ ok: true } & SegmentCount & { capped: boolean; rfmReady: boolean }) | { ok: false; problem: string };

/** Counts a rule set before it is saved (D296), for staff who may save one: the numbers only, never people. */
export async function previewSegmentAction(storeSlug: string, rules: unknown): Promise<PreviewResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const parsed = segmentRulesSchema.safeParse(rules);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "A condition is not complete." };
  const result = await evaluateSegment(member.store, parsed.data);
  return { ok: true, people: result.people, subscribed: result.subscribed, moneyUnknown: result.moneyUnknown, capped: result.capped, rfmReady: result.rfmReady };
}

/** Saves a segment (`marketing:write`) and opens it. */
export async function saveSegmentAction(storeSlug: string, id: string | null, input: unknown): Promise<{ ok: false; problem: string } | void> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problem: NO_ACCESS };
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problem: "Unknown segment." };
  const result = await saveSegment(member.store.id, member.account.id, id, input);
  if (!result.ok) return result;
  redirect(`/admin/${member.store.slug}/segments/${result.id}`);
}

export async function deleteSegmentAction(storeSlug: string, id: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!z.uuid().safeParse(id).success) return;
  await deleteSegment(member.store.id, member.account.id, id);
  refresh();
  redirect(`/admin/${member.store.slug}/segments`);
}
