import { saveStripeCredentialsAction } from "@/app/admin/(gated)/actions";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { PaymentModeName } from "@/lib/payment-methods";
import type { CredentialStatus } from "@/server/settings";

const input =
  "min-h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm disabled:opacity-60";

/** Stripe API keys for one mode. Secrets are write-only: only a hint is shown. */
export function StripeKeysForm({
  storeSlug,
  mode,
  status,
  disabled,
}: {
  storeSlug: string;
  mode: PaymentModeName;
  status: CredentialStatus;
  disabled: boolean;
}) {
  return (
    <section aria-labelledby={`keys-${mode}`} className="rounded-lg border border-border bg-background p-5">
      <h2 id={`keys-${mode}`} className="mb-1 font-medium">
        {mode === "test" ? "Test keys" : "Live keys"}
      </h2>
      <p className="mb-4 text-sm text-muted">
        From the Stripe Dashboard → Developers → API keys{mode === "test" ? ", with Test mode on" : ""}.
        Leave a field empty to keep what is saved.
      </p>
      <ActionForm action={saveStripeCredentialsAction.bind(null, storeSlug)} className="flex flex-col gap-3">
        <input type="hidden" name="mode" value={mode} />
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Publishable key
            <input
              name="publishableKey"
              defaultValue={status.publishableKey ?? ""}
              placeholder={`pk_${mode}_…`}
              autoComplete="off"
              spellCheck={false}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Secret key
            <input
              type="password"
              name="secretKey"
              placeholder={status.secretKeyHint ? `Saved: ${status.secretKeyHint}` : `sk_${mode}_…`}
              autoComplete="off"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Webhook signing secret
            <input
              type="password"
              name="webhookSecret"
              placeholder={status.webhookSecretHint ? `Saved: ${status.webhookSecretHint}` : "whsec_…"}
              autoComplete="off"
              className={input}
            />
            <span className="font-normal text-muted">Needed once checkout is live; it can be added later.</span>
          </label>
          <div>
            <SubmitButton disabled={disabled}>Save {mode} keys</SubmitButton>
          </div>
        </fieldset>
      </ActionForm>
    </section>
  );
}
