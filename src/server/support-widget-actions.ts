import "server-only";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";
import { SITES_MAX, WIDGETS_MAX } from "@/lib/support-embed";

import type { StaffDesk } from "./support-desk";
import { addSite, checkSite, createWidget, deleteWidget, removeSite, saveWidget, type WidgetProblem } from "./support-widgets";

/**
 * What the widget screens' actions do (D582), the same for a store's desk and Kaizena Flow's: each `"use server"` file checks the person
 * (`storeAction()` with `support:write`, or `platformAction()` for the support area), makes the desk and calls one of these, which answer
 * in the person's words. The pages are refreshed by the caller.
 */

const words = (lang: AdminLang) => SUPPORT_WORDS[lang].widgets;
const error = (message: string): FormState => ({ status: "error", messages: [message] });

/** A problem as the person reads it, with the limits filled in. */
export function problemText(lang: AdminLang, problem: WidgetProblem): string {
  const p = words(lang).problems;
  if (problem === "widgetsMax") return fillWords(p.widgetsMax, { n: String(WIDGETS_MAX) });
  if (problem === "sitesMax") return fillWords(p.sitesMax, { n: String(SITES_MAX) });
  return p[problem];
}

const text = (form: FormData, name: string): string => String(form.get(name) ?? "");

/** The new widget's id, or a refusal: the caller sends the person to the widget's page. */
export async function createFromForm(staff: StaffDesk, lang: AdminLang, form: FormData): Promise<{ id: string } | FormState> {
  const result = await createWidget(staff, { name: text(form, "name"), host: text(form, "host") });
  return result.ok ? { id: result.widget.id } : error(problemText(lang, result.problem));
}

/** The look and the rest of a widget, from the editor's fields (each style field by its own name). */
export async function saveFromForm(staff: StaffDesk, lang: AdminLang, id: string, form: FormData, markets: string[] | null): Promise<FormState> {
  const style = Object.fromEntries(
    ["accent", "background", "text", "corners", "side", "offsetX", "offsetY", "launcher", "label", "width", "font", "greeting", "css"].map((key) => {
      const value = text(form, key);
      return [key, ["accent", "background", "text", "font"].includes(key) && !value.trim() ? null : value];
    }),
  );
  const result = await saveWidget(staff, id, { name: text(form, "name"), market: text(form, "market") || null, privacy: text(form, "privacy"), style }, markets);
  return result.ok ? { status: "ok", messages: [words(lang).saved] } : error(problemText(lang, result.problem));
}

export async function deleteFromForm(staff: StaffDesk, lang: AdminLang, id: string): Promise<FormState> {
  return (await deleteWidget(staff, id)) ? { status: "ok", messages: [] } : error(problemText(lang, "gone"));
}

export async function addSiteFromForm(staff: StaffDesk, lang: AdminLang, widgetId: string, form: FormData): Promise<FormState> {
  const result = await addSite(staff, widgetId, text(form, "host"));
  if (!result.ok) return error(problemText(lang, result.problem));
  return { status: "ok", messages: [result.site.verifiedAt ? words(lang).addedLive : words(lang).added] };
}

export async function checkSiteFromForm(staff: StaffDesk, lang: AdminLang, form: FormData): Promise<FormState> {
  const w = words(lang);
  const site = await checkSite(staff.desk, text(form, "id"));
  if (!site) return error(problemText(lang, "gone"));
  if (site.verifiedAt) return { status: "ok", messages: [w.checkedLive] };
  return error(site.checkProblem ? fillWords(w.checkProblem[site.checkProblem], { host: site.host }) : w.checkedNot);
}

export async function removeSiteFromForm(staff: StaffDesk, lang: AdminLang, form: FormData): Promise<FormState> {
  return (await removeSite(staff, text(form, "id"))) ? { status: "ok", messages: [words(lang).removed] } : error(problemText(lang, "gone"));
}
