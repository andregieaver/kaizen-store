"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { bpsOfPercent } from "@/lib/duties";
import { requirePlatformAdmin, type Account } from "@/server/auth";
import { removeDutyRate, saveDutyRate, setDutyRateVerified, type DutyAdminResult } from "@/server/duty-rates";

/** The platform's duty rates (wave 7 unit I, D343): platform admins only, only through `src/server/duty-rates.ts`. */

const said = (account: Account) => adminText(adminLangOf(account.adminLocale), "platformTools").dutyRates.actions;
const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stateOf(result: DutyAdminResult, done: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [done] };
}

/** A percentage typed as people write it, as basis points; a word that is not a number is refused by the row's check. */
const bps = (form: FormData, name: string): number | null | string => {
  const value = bpsOfPercent(text(form, name));
  return value === null ? null : Number.isNaN(value) ? text(form, name) : value;
};

/** Adds a row, or changes the one named by `id`. */
export async function saveDutyRateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const id = text(form, "id");
  return stateOf(
    await saveDutyRate(
      account,
      {
        destination: text(form, "destination"),
        hsPrefix: text(form, "hsPrefix"),
        origin: text(form, "origin"),
        appliesTo: text(form, "appliesTo") || "any",
        dutyRateBps: bps(form, "dutyRate"),
        importVatBps: bps(form, "importVat"),
        thresholdMinor: text(form, "thresholdMinor"),
        vatThresholdMinor: text(form, "vatThresholdMinor"),
        perItemMinor: text(form, "perItemMinor"),
        thresholdCurrency: text(form, "thresholdCurrency"),
        thresholdPer: text(form, "thresholdPer") || "consignment",
        shippingInValue: form.get("shippingInValue") === "on",
        source: text(form, "source"),
        note: text(form, "note"),
        checkedOn: text(form, "checkedOn"),
        verified: form.get("verified") === "on",
        validFrom: text(form, "validFrom"),
        validTo: text(form, "validTo"),
      },
      UUID.test(id) ? id : null,
    ),
    said(account).saved,
  );
}

export async function setDutyRateVerifiedAction(id: string, verified: boolean): Promise<FormState> {
  const account = await requirePlatformAdmin();
  return stateOf(await setDutyRateVerified(account, id, verified), verified ? said(account).verified : said(account).unverified);
}

export async function removeDutyRateAction(id: string): Promise<FormState> {
  const account = await requirePlatformAdmin();
  return stateOf(await removeDutyRate(account, id), said(account).removed);
}
