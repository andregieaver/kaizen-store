"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { featureOffText } from "@/lib/feature-labels";
import { featureOn } from "@/lib/store-features";
import { sendForSigning } from "@/server/contract-signing";
import { renderPdf } from "@/server/invoice-pdf";
import { storeAction } from "@/server/store-action";

/**
 * Sending a contract for signing (D695 step 3). Its own file because it draws the PDF with Chromium (`renderPdf`, `invoice-pdf.ts`): only
 * the contract's page imports it, and that route carries Chromium in `outputFileTracingIncludes` (`next.config.ts`); the other actions
 * stay in `contract-actions.ts`, away from it.
 */

const failed = (message: string): FormState => ({ status: "error", messages: [message] });

export async function sendContractAction(storeSlug: string, contractId: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "customers:write", extension: "deals", action: "contract.send", answer: failed }, async (member) => {
    const lang = adminLangOf(member.account.adminLocale);
    if (!featureOn(member.store, "sales")) return failed(featureOffText("sales", adminText(lang, "common").features));
    const w = adminText(lang, "deals").contracts;
    const sent = await sendForSigning(member, contractId, { render: renderPdf });
    if (!sent.ok) {
      if (sent.problem === "unfilled") {
        return failed(
          sent.fill.map((p) => (p.kind === "missing_field" ? fillWords(w.fill.missing_field, { field: `{${p.key}} (${w.fields[p.key]})` }) : w.fill[p.kind])).join(" "),
        );
      }
      return failed(w.problems[sent.problem]);
    }
    refresh();
    return { status: "ok", messages: [] };
  });
}
