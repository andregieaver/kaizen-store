import { platformDiscountSummary } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import type { StoreBilling } from "@/server/billing";

import { ActionForm, SubmitButton, type FormState } from "./action-form";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");

/**
 * Kaizen's discount code on a store's plan (D31): what it gives and
 * whether Stripe applies it yet, and a field for a code.
 */
export function PlanDiscount({
  discount,
  apply,
  remove,
  canEdit,
}: {
  discount: StoreBilling["discount"];
  apply: Action;
  remove: Action | null;
  canEdit: boolean;
}) {
  return (
    <section aria-labelledby="discount-heading" className="rounded-lg border border-border bg-background p-5 text-sm">
      <h2 id="discount-heading" className="mb-1 font-medium">
        Discount code
      </h2>
      {discount ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p>
            <span className="rounded-full border border-border px-3 py-1 font-mono font-medium">{discount.code}</span>{" "}
            {platformDiscountSummary(discount, money)}
            {discount.appliedAt
              ? ` · applied ${discount.appliedAt.slice(0, 10)}`
              : " · applies when a plan is chosen"}
          </p>
          {remove && !discount.appliedAt && canEdit && (
            <ActionForm action={remove}>
              <SubmitButton variant="secondary">Remove</SubmitButton>
            </ActionForm>
          )}
        </div>
      ) : (
        <p className="mb-4 text-muted">Have a code from Kaizen? It lowers your plan&apos;s invoices.</p>
      )}
      {canEdit && (
        <ActionForm action={apply} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 font-medium">
            {discount ? "Use another code" : "Code"}
            <input
              name="code"
              required
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="min-h-10 w-56 rounded-md border border-border bg-background px-3 font-mono font-normal uppercase"
            />
          </label>
          <SubmitButton variant="secondary">Apply</SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}
