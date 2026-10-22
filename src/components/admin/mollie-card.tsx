import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { paymentsEn, type PaymentsMessages } from "@/lib/admin-messages/payments.en";
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
  words = paymentsEn.mollie,
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
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: PaymentsMessages["mollie"];
}) {
  if (!appOn) return null;
  const w = words;
  const terms = (
    <ul className="list-disc pl-5 text-caption text-muted">
      <li>{w.payPage}</li>
      <li>{w.fee}</li>
      <li>{w.stripeStays}</li>
    </ul>
  );
  if (!connection) {
    return (
      <Card title="Mollie" description={w.connectIntro} compact>
        <div className="flex flex-col gap-3 text-sm">
          {terms}
          {isOwner ? (
            <form action={connectAction}>
              <SubmitButton>{w.connect}</SubmitButton>
            </form>
          ) : (
            <p className="text-muted">{w.ownerOnly}</p>
          )}
        </div>
      </Card>
    );
  }
  return (
    <Card
      title="Mollie"
      description={fillWords(connection.profileName ? w.connectedSite : w.connected, {
        organisation: connection.organizationName ?? connection.organizationId,
        site: connection.profileName ?? "",
      })}
      compact
    >
      <div className="flex flex-col gap-4 text-sm">
        <ActionForm action={providerAction} className="flex flex-col gap-3">
          <fieldset disabled={!isOwner} className="flex flex-col gap-2">
            <legend className="mb-1 text-body-strong text-ink">{w.payWith}</legend>
            {modes.map((mode) => (
              <div key={mode} className="flex flex-wrap items-center gap-4">
                <span className="w-28 text-muted">{mode === "test" ? w.test : w.live}</span>
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
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          )}
        </ActionForm>
        {terms}
        {methods && (
          <div className="flex flex-col gap-2">
            <p className="text-body-strong text-ink">{w.methods}</p>
            <ul className="divide-y divide-line">
              {methods.map((method) => (
                <li key={method.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-ink">{method.description}</span>
                  <span className="flex items-center gap-2">
                    {MOLLIE_LEFT_OUT.has(method.id) ? (
                      <Chip signal="neutral">{w.notOffered}</Chip>
                    ) : method.status === "activated" ? (
                      <Chip signal="positive" dot>
                        {w.active}
                      </Chip>
                    ) : method.status === "pending-review" ? (
                      <Chip signal="warning" dot>
                        {w.checking}
                      </Chip>
                    ) : isOwner ? (
                      <ActionForm action={activateAction}>
                        <input type="hidden" name="method" value={method.id} />
                        <SubmitButton variant="secondary">{w.activate}</SubmitButton>
                      </ActionForm>
                    ) : (
                      <Chip signal="neutral">{w.off}</Chip>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-caption text-muted">
              {w.agreements}{" "}
              <a href={MOLLIE_DASHBOARD} className="underline" target="_blank" rel="noreferrer">
                {w.dashboard}
              </a>
              .
            </p>
          </div>
        )}
        {isOwner && (
          <ActionForm action={disconnectAction}>
            <SubmitButton variant="secondary">{w.disconnect}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
