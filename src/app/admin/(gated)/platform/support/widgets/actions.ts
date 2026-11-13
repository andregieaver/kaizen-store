"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { installFont } from "@/server/fonts";
import { platformAction } from "@/server/store-action";
import { adminText } from "@/lib/admin-text";
import type { AdminLang } from "@/lib/admin-lang";
import { checkKaizenDesk } from "@/server/support-desk";
import { addSiteFromForm, checkSiteFromForm, createFromForm, deleteFromForm, removeSiteFromForm, saveFromForm } from "@/server/support-widget-actions";

/** Kaizena Flow's own chat widgets on its other websites (D582): Kaizena Flow's team with the support area (D510). */

const answer = (message: string): FormState => ({ status: "error", messages: [message] });
const write = (action: string) => ({ area: "support" as const, action, answer });

/** Kaizena Flow's desk for the person, or the refusal in their words. */
async function desk(lang: AdminLang) {
  const staff = await checkKaizenDesk();
  return staff ?? answer(adminText(lang, "support").widgets.problems.noAccess);
}

export async function createKaizenWidgetAction(_state: FormState, form: FormData): Promise<FormState> {
  const made = await platformAction(write("support.widget_create"), async (_account, lang) => {
    const staff = await desk(lang);
    return "desk" in staff ? createFromForm(staff, lang, form) : staff;
  });
  if ("id" in made) redirect(`/admin/platform/support/widgets/${made.id}`);
  return made;
}

export async function saveKaizenWidgetAction(id: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction(write("support.widget_save"), async (_account, lang) => {
    const staff = await desk(lang);
    if (!("desk" in staff)) return staff;
    const result = await saveFromForm(staff, lang, id, form, null);
    if (result.status === "ok") refresh();
    return result;
  });
}

export async function deleteKaizenWidgetAction(id: string): Promise<FormState> {
  const result = await platformAction(write("support.widget_delete"), async (_account, lang) => {
    const staff = await desk(lang);
    return "desk" in staff ? deleteFromForm(staff, lang, id) : staff;
  });
  if (result.status === "ok") redirect("/admin/platform/support/widgets");
  return result;
}

export async function addKaizenWidgetSiteAction(id: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction(write("support.widget_site_add"), async (_account, lang) => {
    const staff = await desk(lang);
    if (!("desk" in staff)) return staff;
    const result = await addSiteFromForm(staff, lang, id, form);
    refresh();
    return result;
  });
}

export async function checkKaizenWidgetSiteAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction(write("support.widget_site_check"), async (_account, lang) => {
    const staff = await desk(lang);
    if (!("desk" in staff)) return staff;
    const result = await checkSiteFromForm(staff, lang, form);
    refresh();
    return result;
  });
}

export async function removeKaizenWidgetSiteAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction(write("support.widget_site_remove"), async (_account, lang) => {
    const staff = await desk(lang);
    if (!("desk" in staff)) return staff;
    const result = await removeSiteFromForm(staff, lang, form);
    refresh();
    return result;
  });
}

/** Copies a Google Fonts family to Kaizena Flow for a widget's look (D59). */
export async function installKaizenWidgetFontAction(family: string) {
  return platformAction(
    { area: "support", action: "support.widget_font", answer: (problem: string) => ({ ok: false as const, problem }) },
    async () => installFont(String(family)),
  );
}
