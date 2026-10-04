"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { checkOwnerRole } from "@/server/permissions";
import { saveWorkSettings, setWorkSeries } from "@/server/work-settings";
import { seriesFromForm, settingsFromForm } from "@/lib/work-settings";

const problems = (messages: string[]): FormState => ({ status: "error", messages });

/** Work's settings (D122): VAT registration, payment details and defaults. Owners only. */
export async function saveWorkSettingsAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return problems(["Only an owner can change Work's settings."]);
  if (!member.store.workOn) return problems(["Work is off. Switch it on in Work settings first."]);
  const saved = await saveWorkSettings(member, settingsFromForm(formData));
  if (!saved.ok) return problems(saved.problems);
  refresh();
  return { status: "ok", messages: ["Settings saved."] };
}

/** The prefix and next number of invoices or credit notes, until the first is issued. Owners only. */
export async function saveWorkSeriesAction(
  storeSlug: string,
  series: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return problems(["Only an owner can change the numbering."]);
  if (!member.store.workOn) return problems(["Work is off. Switch it on in Work settings first."]);
  const saved = await setWorkSeries(member, seriesFromForm(series, formData));
  if (!saved.ok) return problems(saved.problems);
  refresh();
  return { status: "ok", messages: ["Numbering saved."] };
}
