import { fillWords } from "@/lib/admin-fill";
import type { SendAllowanceMessages } from "@/lib/admin-messages/send-allowance.en";
import { EXTENSION_NAMES } from "@/lib/extensions";
import { extrasNotice, extrasTotal, type BilledLine } from "@/lib/extras";
import { formatMoney, minorUnitDigits } from "@/lib/money";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { Card, Field, TextInput } from "./ui";

/**
 * Use beyond what the account's sizes include (D880, D748 E11), on Account, Billing: each extension's use this period against what it
 * includes, what is beyond at its price, and the period's total, billed as lines on the next invoice. The monthly cap is one step away.
 */
export function ExtrasCard({
  lines,
  currency,
  capMinor,
  words: w,
  locale,
  saveCap,
}: {
  lines: readonly BilledLine[];
  currency: string;
  capMinor: number | null;
  words: SendAllowanceMessages["extras"];
  locale: string;
  saveCap: ((state: FormState, form: FormData) => Promise<FormState>) | null;
}) {
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const n = (value: number) => value.toLocaleString(locale);
  const total = extrasTotal(lines);
  const cut = lines.some((line) => line.quantity < line.beyond);
  return (
    <Card title={w.title} description={w.lead} className="text-sm" compact>
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line.extensionId}>
              {fillWords(line.unit === "ai_conversation" ? w.aiLine : w.peopleLine, {
                name: EXTENSION_NAMES[line.extensionId],
                used: n(line.used),
                included: line.included === null ? "∞" : n(line.included),
              })}
              {extrasNotice(line) === "near" && <span className="text-muted"> · {w.near}</span>}
              {line.quantity > 0 && (
                <span className="text-muted"> · {fillWords(w.beyond, { n: n(line.quantity), price: money(line.unitMinor), amount: money(line.amountMinor) })}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="font-medium">{fillWords(w.total, { amount: money(total) })}</p>
        {cut && capMinor !== null && <p className="text-muted">{fillWords(w.capped, { cap: money(capMinor) })}</p>}
        {saveCap && (
          <details>
            <summary className="cursor-pointer font-medium">{w.capTitle}</summary>
            <ActionForm action={saveCap} successMessage={w.saved} className="mt-3 flex flex-wrap items-end gap-2">
              <Field label={fillWords(w.capLabel, { currency })} hint={w.capHint}>
                {(control) => (
                  <TextInput name="cap" inputMode="decimal" defaultValue={capMinor === null ? "" : String(capMinor / 10 ** minorUnitDigits(currency))} {...control} />
                )}
              </Field>
              <SubmitButton variant="secondary">{w.save}</SubmitButton>
            </ActionForm>
          </details>
        )}
      </div>
    </Card>
  );
}
