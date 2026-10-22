import { accountSessionAction, createStripeAccountAction, refreshStripeAccountAction } from "@/app/admin/(gated)/actions";
import { paymentsEn, type PaymentsMessages } from "@/lib/admin-messages/payments.en";
import { accountStage, type PaymentModeName } from "@/lib/stripe-account";
import type { StripeAccount } from "@/server/connect";
import { platformPublishableKey } from "@/server/stripe";

import { ActionForm, SubmitButton } from "./action-form";
import { StripeConnect } from "./stripe-connect";
import { CARD_CLASS } from "@/components/admin/ui";

/**
 * The store's own Stripe account for one mode: set it up, finish Stripe's
 * questions, or manage it, all without leaving the admin.
 */
export function StripeAccountPanel({
  storeSlug,
  mode,
  account,
  isOwner,
  title,
  words = paymentsEn.stripe,
}: {
  storeSlug: string;
  mode: PaymentModeName;
  account: StripeAccount | undefined;
  isOwner: boolean;
  title?: string;
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: PaymentsMessages["stripe"];
}) {
  const w = words;
  const stage = accountStage(account ?? null);
  const publishableKey = platformPublishableKey(mode);
  return (
    <section
      aria-labelledby={`stripe-${mode}-heading`}
      className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}
    >
      <div>
        <h2 id={`stripe-${mode}-heading`} className="text-title text-ink">
          {title ?? (mode === "live" ? w.account : w.testAccount)}
        </h2>
        <p className="text-sm">
          <span className="sr-only">{w.status}</span>
          {w.stages[stage]}
        </p>
        {mode === "test" && (
          <p className="text-sm text-muted">
            {w.testNote}{" "}
            <a href="https://docs.stripe.com/connect/testing" className="underline" target="_blank" rel="noreferrer">
              {w.testDetails}
            </a>{" "}
            {w.testNoteEnd}
          </p>
        )}
      </div>

      {!isOwner ? (
        stage !== "ready" && <p className="text-sm text-muted">{w.ownerSetsUp}</p>
      ) : stage === "not_started" ? (
        <ActionForm action={createStripeAccountAction.bind(null, storeSlug)} successMessage={w.created}>
          <input type="hidden" name="mode" value={mode} />
          <p className="mb-3 text-sm text-muted">{w.setUpIntro}</p>
          <SubmitButton>{w.setUp}</SubmitButton>
        </ActionForm>
      ) : publishableKey ? (
        <StripeConnect
          actions={{
            session: accountSessionAction.bind(null, storeSlug, mode),
            refresh: refreshStripeAccountAction.bind(null, storeSlug, mode),
          }}
          publishableKey={publishableKey}
          stage={stage}
        />
      ) : (
        <p className="text-sm text-muted">{w.cannotShow}</p>
      )}

      {account && (
        <p className="text-sm">
          <a
            href={`https://dashboard.stripe.com${mode === "test" ? "/test" : ""}/payments`}
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            {w.dashboard}
          </a>{" "}
          <span className="text-muted">{w.dashboardFor}</span>
        </p>
      )}
    </section>
  );
}
