"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { installFont } from "@/server/fonts";
import { storeAction } from "@/server/store-action";
import { memberDesk } from "@/server/support-desk";
import { addSiteFromForm, checkSiteFromForm, createFromForm, deleteFromForm, removeSiteFromForm, saveFromForm } from "@/server/support-widget-actions";

/**
 * A store's chat widgets on the owner's own websites (D582): every change asks `support:write`. The widget's frame reads the widget
 * per request, so only the admin's pages are refreshed.
 */

const answer = (message: string): FormState => ({ status: "error", messages: [message] });
const write = (slug: string, action: string) => ({ store: slug, key: "support:write" as const, action, answer });

export async function createWidgetAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  const made = await storeAction(write(slug, "support.widget_create"), async (member, lang) => createFromForm(memberDesk(member), lang, form));
  if ("id" in made) redirect(`/admin/${slug}/support/widgets/${made.id}`);
  return made;
}

export async function saveWidgetAction(slug: string, id: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction(write(slug, "support.widget_save"), async (member, lang) => {
    const result = await saveFromForm(memberDesk(member), lang, id, form, member.store.markets.map((market) => market.slug));
    if (result.status === "ok") refresh();
    return result;
  });
}

export async function deleteWidgetAction(slug: string, id: string): Promise<FormState> {
  const result = await storeAction(write(slug, "support.widget_delete"), async (member, lang) => deleteFromForm(memberDesk(member), lang, id));
  if (result.status === "ok") redirect(`/admin/${slug}/support/widgets`);
  return result;
}

export async function addWidgetSiteAction(slug: string, id: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction(write(slug, "support.widget_site_add"), async (member, lang) => {
    const result = await addSiteFromForm(memberDesk(member), lang, id, form);
    refresh();
    return result;
  });
}

export async function checkWidgetSiteAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction(write(slug, "support.widget_site_check"), async (member, lang) => {
    const result = await checkSiteFromForm(memberDesk(member), lang, form);
    refresh();
    return result;
  });
}

export async function removeWidgetSiteAction(slug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction(write(slug, "support.widget_site_remove"), async (member, lang) => {
    const result = await removeSiteFromForm(memberDesk(member), lang, form);
    refresh();
    return result;
  });
}

/** Copies a Google Fonts family to Kaizena Flow for a widget's look (D59), as the font picker asks when a font is chosen. */
export async function installWidgetFontAction(slug: string, family: string) {
  return storeAction(
    { store: slug, key: "support:write", action: "support.widget_font", answer: (problem: string) => ({ ok: false as const, problem }) },
    async () => installFont(String(family)),
  );
}

