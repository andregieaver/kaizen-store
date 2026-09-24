import { createStripeAccountAction } from "@/app/admin/(gated)/actions";
import { accountStage, type AccountStage, type PaymentModeName } from "@/lib/stripe-account";
import type { StripeAccount } from "@/server/connect";
import { platformPublishableKey } from "@/server/stripe";

import { ActionForm, SubmitButton } from "./action-form";
import { StripeConnect } from "./stripe-connect";

const STAGE_TEXT: Record<AccountStage, string> = {
  not_started: "Not set up yet.",
  needs_info: "Stripe needs a few more details before your store can take payments.",
  in_review: "Stripe is checking your details. This usually takes minutes, sometimes a day or two.",
  ready: "Ready: your store can take payments.",
};

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
}: {
  storeSlug: string;
  mode: PaymentModeName;
  account: StripeAccount | undefined;
  isOwner: boolean;
  title?: string;
}) {
  const stage = accountStage(account ?? null);
  const publishableKey = platformPublishableKey(mode);
  return (
    <section
      aria-labelledby={`stripe-${mode}-heading`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
    >
      <div>
        <h2 id={`stripe-${mode}-heading`} className="font-medium">
          {title ?? (mode === "live" ? "Stripe account" : "Stripe test account")}
        </h2>
        <p className="text-sm">
          <span className="sr-only">Status: </span>
          {STAGE_TEXT[stage]}
        </p>
        {mode === "test" && (
          <p className="text-sm text-muted">
            Test mode takes no real money. Stripe accepts{" "}
            <a href="https://docs.stripe.com/connect/testing" className="underline" target="_blank" rel="noreferrer">
              test details
            </a>{" "}
            here, such as the verification code 000000.
          </p>
        )}
      </div>

      {!isOwner ? (
        stage !== "ready" && <p className="text-sm text-muted">An owner of the store sets this up.</p>
      ) : stage === "not_started" ? (
        <ActionForm action={createStripeAccountAction.bind(null, storeSlug)} successMessage="Account created.">
          <input type="hidden" name="mode" value={mode} />
          <p className="mb-3 text-sm text-muted">
            Your store gets its own Stripe account: shoppers pay your business directly, and Stripe
            pays out to your bank. Stripe asks who runs the business and where to send payouts; it
            takes about ten minutes. Have your organisation number and bank account ready.
          </p>
          <SubmitButton>Set up Stripe</SubmitButton>
        </ActionForm>
      ) : publishableKey ? (
        <StripeConnect storeSlug={storeSlug} mode={mode} publishableKey={publishableKey} stage={stage} />
      ) : (
        <p className="text-sm text-muted">Stripe cannot be shown right now. Try again later.</p>
      )}

      {account && (
        <p className="text-sm">
          <a
            href={`https://dashboard.stripe.com${mode === "test" ? "/test" : ""}/payments`}
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Open your Stripe Dashboard
          </a>{" "}
          <span className="text-muted">for payouts, refunds, receipts and payment methods.</span>
        </p>
      )}
    </section>
  );
}
