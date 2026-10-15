import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { CARD_CLASS } from "@/components/admin/ui";
import { BRING_RETURN_DEFAULT, BRING_RETURN_SERVICES } from "@/lib/bring";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm disabled:opacity-60";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = `flex flex-col gap-4 p-5 ${CARD_CLASS}`;

export type ExchangeSettingsValues = { exchanges: boolean; labelCarrier: string | null; labelService: string | null; labelAuto: boolean };

/**
 * The exchange and return label settings (wave 3, D239, `docs/wave-3-exchanges.md` 2.2, 2.3) on the store's return settings page: *Offer exchanges* (on by default),
 * the carrier return labels are booked with and its service, and *Book withdrawals' labels automatically* (off by default; needs a carrier). Owners change them; the
 * action asks for the owner again and the server checks every value. `carriers` are the store's connected carriers that book return labels.
 */
export function ExchangeSettingsForm({
  values,
  carriers,
  canEdit,
  action,
  integrationsHref,
}: {
  values: ExchangeSettingsValues;
  carriers: { id: string; name: string; ready: boolean }[];
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** `/admin/{store}/integrations` */
  integrationsHref: string;
}) {
  return (
    <ActionForm action={action} successMessage="Saved." className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="exchanges" className={card}>
          <h2 id="exchanges" className="text-title text-ink">
            Exchanges
          </h2>
          <p className="text-sm text-muted">
            Instead of money back, a customer can get other goods: you propose the replacements on the return&apos;s page and the return&apos;s credit pays for a new order. The
            customer confirms on a page of their own; until then they are refunded as usual. A withdrawal is only exchanged on the customer&apos;s own confirmation.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="exchanges" defaultChecked={values.exchanges} className="mt-0.5 size-4" />
            <span>
              Offer exchanges <span className={hint}>(customers can ask for one on their return&apos;s page, and staff can propose one)</span>
            </span>
          </label>
        </section>

        <section aria-labelledby="labels" className={card}>
          <h2 id="labels" className="text-title text-ink">
            Return labels
          </h2>
          <p className="text-sm text-muted">
            Book a return label with your carrier from a return&apos;s page: the customer gets a button to print it, and when they pay return shipping its cost is taken off
            the refund, never more than the label cost. Labels are booked on your own agreement with the carrier.
          </p>
          {carriers.length === 0 ? (
            <p className="text-sm">
              No connected carrier books return labels yet. Connect Posten / Bring under{" "}
              <a href={integrationsHref} className="underline">
                Integrations
              </a>
              .
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                Carrier
                <select name="labelCarrier" defaultValue={values.labelCarrier ?? ""} className={input}>
                  <option value="">None chosen</option>
                  {carriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.ready ? "" : " (not checked yet)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Return service <span className={hint}>(one your agreement covers)</span>
                <select name="labelService" defaultValue={values.labelService ?? ""} className={input}>
                  <option value="">The carrier&apos;s default ({BRING_RETURN_DEFAULT})</option>
                  {BRING_RETURN_SERVICES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} {s.name}
                      {s.confirmed ? "" : " (to be confirmed with Bring)"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="labelAuto" defaultChecked={values.labelAuto} className="mt-0.5 size-4" />
            <span>
              Book withdrawals&apos; return labels automatically{" "}
              <span className={hint}>(a withdrawal is approved from the start; its label is booked within a few minutes, never while the customer confirms)</span>
            </span>
          </label>
        </section>

        {canEdit && (
          <div>
            <SubmitButton>Save exchanges and labels</SubmitButton>
          </div>
        )}
      </fieldset>
    </ActionForm>
  );
}
