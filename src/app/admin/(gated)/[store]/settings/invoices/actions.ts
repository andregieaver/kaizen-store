"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { saveInvoiceSettings, setSeries } from "@/server/invoice-settings";

/**
 * The invoicing settings (D159, `docs/wave-1b-invoices.md` 2.3): the switch, the note and the email option, and each series' prefix and first
 * number until its first document is issued. Only an owner changes any of it, because it changes legal numbering: each action asks the owner
 * key, and the server function checks it again and the fields with the same schema the browser can use. Saving writes `invoice.settings_updated`
 * or `invoice.series_set` to the activity log (the names of what changed, never the note's text).
 */

const failed = (messages: string[]): FormState => ({ status: "error", messages });

export async function saveInvoiceSettingsAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return failed([NO_ACCESS]);
  // An unticked box is absent from the form, so each is read as on or off: a missing one is never "the default".
  const saved = await saveInvoiceSettings(member, {
    enabled: form.get("enabled") === "on",
    footerNote: String(form.get("footerNote") ?? ""),
    emailWithConfirmation: form.get("emailWithConfirmation") === "on",
  });
  if (!saved.ok) return failed(saved.problems);
  refresh();
  return { status: "ok", messages: [saved.settings.enabled ? "Saved. Invoices are made for orders paid from now on." : "Saved. New orders get no invoice."] };
}

export async function setSeriesAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return failed([NO_ACCESS]);
  const saved = await setSeries(member, {
    series: String(form.get("series") ?? ""),
    prefix: String(form.get("prefix") ?? ""),
    nextNumber: String(form.get("nextNumber") ?? ""),
  });
  if (!saved.ok) return failed(saved.problems);
  refresh();
  return { status: "ok", messages: ["Saved."] };
}
