import { adminDate } from "@/lib/admin-date";
import { platformDiscountSummary } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import type { StoreBilling } from "@/server/billing";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { BillingMessages } from "@/lib/admin-messages/billing.en";

import { ActionForm, SubmitButton, type FormState } from "./action-form";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;


/**
 * Kaizen's discount code on a store's plan (D31): what it gives and
 * whether Stripe applies it yet, and a field for a code.
 */
export function PlanDiscount({
  discount,
  apply,
  remove,
  canEdit,
  words,
  locale = "nb-NO",
  timeZone,
}: {
  discount: StoreBilling["discount"];
  apply: Action;
  remove: Action | null;
  canEdit: boolean;
  /** The account's words (D312 A8). */
  words: BillingMessages;
  /** How amounts are written. */
  locale?: string;
  /** The store's time zone: the day the code was applied is the store's (D786). */
  timeZone: string;
}) {
  const w = words.discount;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  return (
    <Card title={w.title} className="text-sm" compact>
      {discount ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p>
            <span className="rounded-full border border-line px-3 py-1 font-mono font-medium">{discount.code}</span>{" "}
            {platformDiscountSummary(discount, money, words.discount)}
            {discount.appliedAt ? fillWords(w.applied, { date: adminDate(timeZone, discount.appliedAt, "day", locale) }) : w.applies}
          </p>
          {remove && !discount.appliedAt && canEdit && (
            <ActionForm action={remove}>
              <SubmitButton variant="secondary">{w.remove}</SubmitButton>
            </ActionForm>
          )}
        </div>
      ) : (
        <p className="mb-4 text-muted">{w.have}</p>
      )}
      {canEdit && (
        <ActionForm action={apply} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 font-medium">
            {discount ? w.another : w.code}
            <input
              name="code"
              required
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="min-h-10 w-56 rounded-md border border-line bg-card px-3 font-mono font-normal uppercase"
            />
          </label>
          <SubmitButton variant="secondary">{w.apply}</SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}
