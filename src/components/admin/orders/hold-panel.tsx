import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { RULE_LIMITS } from "@/lib/order-rules";
import type { OrderHold } from "@/server/order-hold";

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * An order's fulfilment hold on its page (wave 3, D238, `docs/wave-3-notifications.md` 2.6): the banner *On hold: {reason}* (by the rule, linked, or by the
 * person) with *Release*, or, for a paid order not sent in full, *Hold fulfilment* with a reason. While held, nothing of the order can be sent or handed
 * over; refunds, cancelling, editing, notes, tags and emails are not affected. The buttons are offered with `orders:write` (the actions ask again).
 */
export function HoldPanel({
  hold,
  base,
  when,
  release,
  holdAction,
}: {
  hold: OrderHold | null;
  /** `/admin/{store}`. */
  base: string;
  when: (iso: string) => string;
  /** Release, or null when the person may not (or the order is not held). */
  release: FormAction | null;
  /** Hold, or null when the person may not or the order cannot be held (unpaid, sent in full, copied). */
  holdAction: FormAction | null;
}) {
  if (hold) {
    const by = hold.rule ? (
      <>
        by the rule{" "}
        {hold.rule.name ? (
          <Link href={`${base}/settings/automation/${hold.rule.id}`} className="underline underline-offset-2">
            {hold.rule.name}
          </Link>
        ) : (
          "that was deleted since"
        )}
      </>
    ) : hold.byAccount ? (
      <>by {hold.byAccount.name ?? "a member of staff"}</>
    ) : null;
    return (
      <section role="status" aria-label="On hold" className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-warning-line bg-warning-soft p-4 text-warning-text">
        <p className="text-body">
          <span className="text-body-strong">On hold: {hold.reason}</span> ({by ? <>{by}, </> : null}
          {when(hold.heldAt)}). Nothing of this order can be sent or handed over until it is released.
        </p>
        {release && (
          <ActionForm action={release} successMessage="Released.">
            <SubmitButton variant="secondary">Release</SubmitButton>
          </ActionForm>
        )}
      </section>
    );
  }
  if (!holdAction) return null;
  return (
    <details className="rounded-panel border border-line bg-card p-4">
      <summary className="cursor-pointer text-sm">Hold fulfilment</summary>
      <ActionForm action={holdAction} successMessage="The order is on hold." className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Why it is held <span className="font-normal text-muted">(staff see this; at most {RULE_LIMITS.reason} characters)</span>
          <input name="reason" required maxLength={RULE_LIMITS.reason} className="min-h-10 w-full max-w-xl rounded-md border border-line bg-card px-3 text-sm font-normal" />
        </label>
        <div>
          <SubmitButton variant="secondary">Hold</SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
