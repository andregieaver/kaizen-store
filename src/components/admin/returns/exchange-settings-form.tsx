import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { CARD_CLASS } from "@/components/admin/ui";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
import { fillWords } from "@/lib/admin-fill";
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
  words = returnsEn,
}: {
  values: ExchangeSettingsValues;
  carriers: { id: string; name: string; ready: boolean }[];
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** `/admin/{store}/integrations` */
  integrationsHref: string;
  words?: ReturnsMessages;
}) {
  const t = words.settings;
  return (
    <ActionForm action={action} successMessage={t.saved} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="exchanges" className={card}>
          <h2 id="exchanges" className="text-title text-ink">
            {t.exchanges}
          </h2>
          <p className="text-sm text-muted">{t.exchangesText}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="exchanges" defaultChecked={values.exchanges} className="mt-0.5 size-4" />
            <span>
              {t.offer} <span className={hint}>{t.offerHint}</span>
            </span>
          </label>
        </section>

        <section aria-labelledby="labels" className={card}>
          <h2 id="labels" className="text-title text-ink">
            {t.labels}
          </h2>
          <p className="text-sm text-muted">{t.labelsText}</p>
          {carriers.length === 0 ? (
            <p className="text-sm">
              {t.noCarrier}{" "}
              <a href={integrationsHref} className="underline">
                {t.integrations}
              </a>
              .
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                {t.carrier}
                <select name="labelCarrier" defaultValue={values.labelCarrier ?? ""} className={input}>
                  <option value="">{t.noneChosen}</option>
                  {carriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.ready ? "" : t.notChecked}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t.service} <span className={hint}>{t.serviceHint}</span>
                <select name="labelService" defaultValue={values.labelService ?? ""} className={input}>
                  <option value="">{fillWords(t.carrierDefault, { service: BRING_RETURN_DEFAULT })}</option>
                  {BRING_RETURN_SERVICES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} {s.name}
                      {s.confirmed ? "" : t.toConfirm}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="labelAuto" defaultChecked={values.labelAuto} className="mt-0.5 size-4" />
            <span>
              {t.auto} <span className={hint}>{t.autoHint}</span>
            </span>
          </label>
        </section>

        {canEdit && (
          <div>
            <SubmitButton>{t.saveExchanges}</SubmitButton>
          </div>
        )}
      </fieldset>
    </ActionForm>
  );
}
