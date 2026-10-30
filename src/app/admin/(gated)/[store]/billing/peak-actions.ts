"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { parsePeak } from "@/lib/capacity-events";
import { addPeak, removePeak } from "@/server/capacity-events";
import { requireOwnerRole } from "@/server/permissions";

/** An owner tells Kaizena Flow of a busy time (D314, `docs/capacity.md` step 4.1). */
export async function addPeakAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const { account, store } = await requireOwnerRole(storeSlug);
  const w = adminText(adminLangOf(account.adminLocale), "capacity");
  const peak = parsePeak({ starts: form.get("starts"), ends: form.get("ends"), expected: form.get("expected"), note: form.get("note") });
  if (!peak) return { status: "error", messages: [w.peaks.invalid] };
  await addPeak(account.id, store.id, peak);
  refresh();
  return { status: "ok", messages: [w.peaks.added] };
}

export async function removePeakAction(storeSlug: string, id: string): Promise<FormState> {
  const { account, store } = await requireOwnerRole(storeSlug);
  await removePeak(account.id, store.id, id);
  refresh();
  return { status: "ok", messages: [] };
}
