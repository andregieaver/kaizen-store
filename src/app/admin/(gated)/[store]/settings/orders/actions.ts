"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { paymentsEn } from "@/lib/admin-messages/payments.en";
import { adminText } from "@/lib/admin-text";
import { knownText } from "@/lib/known-words";
import { AUTO_ARCHIVE_MAX_DAYS, AUTO_ARCHIVE_MIN_DAYS } from "@/lib/order-limits";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { isCaptureSetting } from "@/lib/capture";
import { saveOrderSettings, SETTINGS_PROBLEMS, type OrderSettingsInput } from "@/server/order-settings";

/**
 * Saves the store's order settings (wave 3, D173, `docs/wave-3-orders.md` 2.3): gift messages, automatic archiving, how long a draft's pay link is valid and who may record
 * a payment taken outside Kaizen. `settings:write` changes them; the last is the owner's alone (`saveOrderSettings()` refuses it from anyone else, and the form does not send
 * it from them). The server checks every value again and writes the audit entry.
 */
export async function saveOrderSettingsAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "payments").problems.noChange] };
  const w = adminText(adminLangOf(member.account.adminLocale), "payments");
  const said = (text: string) => knownText(text, paymentsEn.problems, w.problems);

  const input: OrderSettingsInput = { giftMessages: form.get("giftMessages") === "on" };

  if (form.get("autoArchive") === "on") {
    const days = Number(String(form.get("autoArchiveDays") ?? "").trim());
    if (!Number.isInteger(days) || days < AUTO_ARCHIVE_MIN_DAYS || days > AUTO_ARCHIVE_MAX_DAYS) {
      return { status: "error", messages: [fillWords(w.problems.archiveRange, { min: AUTO_ARCHIVE_MIN_DAYS, max: AUTO_ARCHIVE_MAX_DAYS })] };
    }
    input.autoArchiveDays = days;
  } else {
    input.autoArchiveDays = null;
  }

  const valid = Number(String(form.get("draftValidDays") ?? "").trim());
  if (!Number.isInteger(valid)) return { status: "error", messages: [w.problems.draftWhole] };
  input.draftValidDays = valid;

  // Only the owner decides whether others may record money taken outside Kaizen: a form from anyone else does not carry the choice.
  if (form.get("staffMarkPaidShown") === "1") input.staffMarkPaid = form.get("staffMarkPaid") === "on";
  // When the card is charged (D289) is the owner's too.
  if (form.get("captureShown") === "1") {
    const capture = form.get("capture");
    if (!isCaptureSetting(capture)) return { status: "error", messages: [said(SETTINGS_PROBLEMS.capture)] };
    input.capture = capture;
  }

  const saved = await saveOrderSettings(member, input);
  if (!saved.ok) return { status: "error", messages: [said(saved.problem)] };
  refresh();
  return { status: "ok", messages: [w.actions.saved] };
}
