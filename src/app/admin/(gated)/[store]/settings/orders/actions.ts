"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { AUTO_ARCHIVE_MAX_DAYS, AUTO_ARCHIVE_MIN_DAYS } from "@/lib/order-limits";
import { checkPermission } from "@/server/permissions";
import { saveOrderSettings, type OrderSettingsInput } from "@/server/order-settings";

const NO_ACCESS = "You do not have access to change these settings.";

/**
 * Saves the store's order settings (wave 3, D173, `docs/wave-3-orders.md` 2.3): gift messages, automatic archiving, how long a draft's pay link is valid and who may record
 * a payment taken outside Kaizen. `settings:write` changes them; the last is the owner's alone (`saveOrderSettings()` refuses it from anyone else, and the form does not send
 * it from them). The server checks every value again and writes the audit entry.
 */
export async function saveOrderSettingsAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };

  const input: OrderSettingsInput = { giftMessages: form.get("giftMessages") === "on" };

  if (form.get("autoArchive") === "on") {
    const days = Number(String(form.get("autoArchiveDays") ?? "").trim());
    if (!Number.isInteger(days) || days < AUTO_ARCHIVE_MIN_DAYS || days > AUTO_ARCHIVE_MAX_DAYS) {
      return { status: "error", messages: [`Automatic archiving waits ${AUTO_ARCHIVE_MIN_DAYS} to ${AUTO_ARCHIVE_MAX_DAYS} days after an order's last event.`] };
    }
    input.autoArchiveDays = days;
  } else {
    input.autoArchiveDays = null;
  }

  const valid = Number(String(form.get("draftValidDays") ?? "").trim());
  if (!Number.isInteger(valid)) return { status: "error", messages: ["Write how many days a pay link is valid, as a whole number."] };
  input.draftValidDays = valid;

  // Only the owner decides whether others may record money taken outside Kaizen: a form from anyone else does not carry the choice.
  if (form.get("staffMarkPaidShown") === "1") input.staffMarkPaid = form.get("staffMarkPaid") === "on";

  const saved = await saveOrderSettings(member, input);
  if (!saved.ok) return { status: "error", messages: [saved.problem] };
  refresh();
  return { status: "ok", messages: ["Saved."] };
}
