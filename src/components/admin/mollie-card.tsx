import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { MOLLIE_DASHBOARD, MOLLIE_LEFT_OUT } from "@/lib/mollie";
import type { PaymentModeName } from "@/lib/stripe-account";
import type { MollieConnection } from "@/server/mollie";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Mollie on the Payments page (wave 4 unit E2, D292): connect the store's Mollie account by approving Kaizena Flow at Mollie, then choose Mollie for a
 * mode's checkout. Mollie brings PayPal, Vipps, Swish and MobilePay, which Stripe does not give a store on Kaizena Flow. What stays on Stripe, and that
 * Kaizena Flow's fee is not returned on a Mollie refund, is said before the owner connects.
 */
export function MollieCard({
  connection,
  appOn,
  isOwner,
  modes,
  chosen,
  methods,
  connectAction,
  providerAction,
  disconnectAction,
  activateAction,
}: {
  connection: MollieConnection | null;
  appOn: boolean;
  isOwner: boolean;
  modes: readonly PaymentModeName[];
  chosen: Partial<Record<PaymentModeName, "stripe" | "mollie">>;
  methods: { id: string; description: string; status: string | null }[] | null;
  connectAction: () => Promise<void>;
  providerAction: Action;
  disconnectAction: () => Promise<FormState>;
  activateAction: Action;
}) {
  if (!appOn) return null;
  const terms = (
    <ul className="list-disc pl-5 text-caption text-muted">
      <li>Shoppers pay on Mollie&apos;s own page. Kaizena Flow asks for their name, email and delivery address first.</li>
      <li>Kaizena Flow&apos;s fee is taken on each Mollie payment and is not given back when you refund one.</li>
      <li>Subscriptions, deposits and hosts&apos; listings are still paid through Stripe.</li>
    </ul>
  );
  if (!connection) {
    return (
      <Card title="Mollie" description="Take payments through your own Mollie account instead: PayPal, Vipps, Swish, MobilePay, iDEAL, Bancontact and more." compact>
        <div className="flex flex-col gap-3 text-sm">
          {terms}
          {isOwner ? (
            <form action={connectAction}>
              <SubmitButton>Connect Mollie</SubmitButton>
            </form>
          ) : (
            <p className="text-muted">Only an owner can connect Mollie.</p>
          )}
        </div>
      </Card>
    );
  }
  return (
    <Card
      title="Mollie"
      description={`Connected to ${connection.organizationName ?? connection.organizationId}${connection.profileName ? `, website ${connection.profileName}` : ""}.`}
      compact
    >
      <div className="flex flex-col gap-4 text-sm">
        <ActionForm action={providerAction} className="flex flex-col gap-3">
          <fieldset disabled={!isOwner} className="flex flex-col gap-2">
            <legend className="mb-1 text-body-strong text-ink">Shoppers pay with</legend>
            {modes.map((mode) => (
              <div key={mode} className="flex flex-wrap items-center gap-4">
                <span className="w-28 text-muted">{mode === "test" ? "Test payments" : "Real payments"}</span>
                {(["stripe", "mollie"] as const).map((provider) => (
                  <label key={provider} className="flex items-center gap-2">
                    <input type="radio" name={`provider:${mode}`} value={provider} defaultChecked={(chosen[mode] ?? "stripe") === provider} />
                    {provider === "stripe" ? "Stripe" : "Mollie"}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
          {isOwner && (
            <div>
              <SubmitButton>Save</SubmitButton>
            </div>
          )}
        </ActionForm>
        {terms}
        {methods && (
          <div className="flex flex-col gap-2">
            <p className="text-body-strong text-ink">Methods at Mollie</p>
            <ul className="divide-y divide-line">
              {methods.map((method) => (
                <li key={method.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-ink">{method.description}</span>
                  <span className="flex items-center gap-2">
                    {MOLLIE_LEFT_OUT.has(method.id) ? (
                      <Chip signal="neutral">Not offered yet</Chip>
                    ) : method.status === "activated" ? (
                      <Chip signal="positive" dot>
                        Active
                      </Chip>
                    ) : method.status === "pending-review" ? (
                      <Chip signal="warning" dot>
                        Mollie is checking
                      </Chip>
                    ) : isOwner ? (
                      <ActionForm action={activateAction}>
                        <input type="hidden" name="method" value={method.id} />
                        <SubmitButton variant="secondary">Activate</SubmitButton>
                      </ActionForm>
                    ) : (
                      <Chip signal="neutral">Off</Chip>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-caption text-muted">
              Vipps and MobilePay need your own agreement with them, Swish a business in the EEA. Switch those on in your{" "}
              <a href={MOLLIE_DASHBOARD} className="underline" target="_blank" rel="noreferrer">
                Mollie Dashboard
              </a>
              .
            </p>
          </div>
        )}
        {isOwner && (
          <ActionForm action={disconnectAction}>
            <SubmitButton variant="secondary">Disconnect Mollie</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
