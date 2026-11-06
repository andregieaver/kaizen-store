"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, type AdminAreaMessages } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { requirePlatformAdmin } from "@/server/auth";
import { copySiteIntoHouse } from "@/server/house-site";
import { setSiteFromStore } from "@/server/house-switch";

/** Copies Kaizena Flow's site into its own store (D469, step 3 of the plan): the live site does not change. */
export async function copySiteAction(): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").houseSite;
  const result = await copySiteIntoHouse(admin);
  if (!result.ok) return { status: "error", messages: [result.problem === "no_store" ? w.noStore : result.problem === "on_site" ? w.onSite : w.failed] };
  const pages = result.counts.page ?? 0;
  return { status: "ok", messages: [fillWords(w.copied, { pages: String(pages) })] };
}

/** Serves kaizenaflow.com from Kaizena Flow's own store (D474, step 5 of the plan): asks that the copy was looked at. */
export async function switchSiteOnAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").siteSwitch;
  if (formData.get("looked") !== "on") return { status: "error", messages: [w.looked], fields: { looked: w.looked } };
  return switched(await setSiteFromStore(admin, true), w, w.switchedOn);
}

/** Shows the platform's own pages on kaizenaflow.com again (D474); the store is made private again. */
export async function switchSiteOffAction(): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "console").siteSwitch;
  return switched(await setSiteFromStore(admin, false), w, w.switchedOff);
}

type SwitchWords = AdminAreaMessages["console"]["siteSwitch"];

function switched(result: Awaited<ReturnType<typeof setSiteFromStore>>, w: SwitchWords, done: string): FormState {
  if (!result.ok) {
    const message = result.problem === "not_copied" ? w.notCopied : result.problem === "no_store" ? w.noStore : w.failed;
    return { status: "error", messages: [message] };
  }
  refresh();
  return { status: "ok", messages: [result.changed ? done : w.unchanged] };
}
