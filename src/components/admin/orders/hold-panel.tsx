import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { RULE_LIMITS } from "@/lib/order-rules";
import type { OrderHold } from "@/server/order-hold";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";
import { fillWords } from "@/lib/admin-fill";

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
  words: w = orderEn.hold,
}: {
  /** The `order` catalogue's `hold` words in the account's language (D312 A4). */
  words?: OrderMessages["hold"];
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
        {w.byRule}{" "}
        {hold.rule.name ? (
          <Link href={`${base}/settings/automation/${hold.rule.id}`} className="underline underline-offset-2">
            {hold.rule.name}
          </Link>
        ) : (
          w.ruleDeleted
        )}
      </>
    ) : hold.byAccount ? (
      <>{fillWords(w.byPerson, { name: hold.byAccount.name ?? w.staffMember })}</>
    ) : null;
    return (
      <section role="status" aria-label={w.onHold} className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-warning-line bg-warning-soft p-4 text-warning-text">
        <p className="text-body">
          <span className="text-body-strong">{fillWords(w.onHoldReason, { reason: hold.reason })}</span> ({by ? <>{by}, </> : null}
          {when(hold.heldAt)}{w.nothing}
        </p>
        {release && (
          <ActionForm action={release} successMessage={w.released}>
            <SubmitButton variant="secondary">{w.release}</SubmitButton>
          </ActionForm>
        )}
      </section>
    );
  }
  if (!holdAction) return null;
  return (
    <details className="rounded-panel border border-line bg-card p-4">
      <summary className="cursor-pointer text-sm">{w.holdFulfilment}</summary>
      <ActionForm action={holdAction} successMessage={w.isOnHold} className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.why} <span className="font-normal text-muted">{fillWords(w.whyHint, { max: RULE_LIMITS.reason })}</span>
          <input name="reason" required maxLength={RULE_LIMITS.reason} className="min-h-10 w-full max-w-xl rounded-md border border-line bg-card px-3 text-sm font-normal" />
        </label>
        <div>
          <SubmitButton variant="secondary">{w.hold}</SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}
