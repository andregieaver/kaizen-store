import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
import type { InstructionTranslations } from "@/lib/return-instructions";
import { MAX_INSTRUCTIONS, MAX_TRANSIT_DAYS, MAX_WINDOW_DAYS, MIN_WINDOW_DAYS, type ReturnSettings } from "@/lib/withdrawal";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm disabled:opacity-60";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

export type SettingsLanguage = { locale: string; name: string };

/**
 * The store's rules for returns (D153, `docs/returns.md`). Owners change them; everyone else sees them as they are. The
 * legal 14 days are never shortened: the window is 14 days at least, and the days beyond are the store's own offer, which it may
 * decline case by case. The instructions are written in the store's main language, with a text for each of its other languages
 * (or accepted from the store translation, which keeps them as suggestions until a person has read them).
 */
export function ReturnSettingsForm({
  settings,
  translations,
  main,
  others,
  canEdit,
  action,
  translateHref,
  sellsToBusinesses = true,
  words = returnsEn,
}: {
  settings: ReturnSettings;
  translations: InstructionTranslations;
  main: SettingsLanguage;
  others: SettingsLanguage[];
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** `/admin/{store}/translate`, where AI can suggest the translations. */
  translateHref: string;
  /** Sell to businesses is on (D178): only then is the choice about companies' returns shown; off, it is kept as it was. */
  sellsToBusinesses?: boolean;
  words?: ReturnsMessages;
}) {
  const t = words.settings;
  const address = settings.returnAddress;
  return (
    <ActionForm action={action} successMessage={t.saved} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="window" className={card}>
          <h2 id="window" className="text-title text-ink">
            {t.window}
          </h2>
          <p className="text-sm text-muted">{fillWords(t.windowText, { min: MIN_WINDOW_DAYS })}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              {t.windowDays} <span className={hint}>{fillWords(t.range, { min: MIN_WINDOW_DAYS, max: MAX_WINDOW_DAYS })}</span>
              <input name="windowDays" type="number" inputMode="numeric" min={MIN_WINDOW_DAYS} max={MAX_WINDOW_DAYS} defaultValue={settings.windowDays} required className={input} />
            </label>
            <label className={label}>
              {t.transit} <span className={hint}>{fillWords(t.transitRange, { max: MAX_TRANSIT_DAYS })}</span>
              <input name="transitDays" type="number" inputMode="numeric" min={0} max={MAX_TRANSIT_DAYS} defaultValue={settings.transitDays} required className={input} />
              <span className={hint}>{fillWords(t.transitHint, { min: MIN_WINDOW_DAYS })}</span>
            </label>
          </div>
        </section>

        <section aria-labelledby="money" className={card}>
          <h2 id="money" className="text-title text-ink">
            {t.money}
          </h2>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">{t.returnShipping}</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="whoPaysReturn" value="shopper" defaultChecked={settings.whoPaysReturn === "shopper"} className="mt-0.5 size-4" />
              <span>{t.shopperPays}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="whoPaysReturn" value="store" defaultChecked={settings.whoPaysReturn === "store"} className="mt-0.5 size-4" />
              <span>{t.storePays}</span>
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">{t.when}</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="refundWhen" value="received" defaultChecked={settings.refundWhen === "received"} className="mt-0.5 size-4" />
              <span>{t.whenReceived}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="refundWhen" value="request" defaultChecked={settings.refundWhen === "request"} className="mt-0.5 size-4" />
              <span>{t.whenRequest}</span>
            </label>
          </fieldset>
        </section>

        <section aria-labelledby="scope" className={card}>
          <h2 id="scope" className="text-title text-ink">
            {t.scope}
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="acceptExcluded" defaultChecked={settings.acceptExcluded} className="mt-0.5 size-4" />
            <span>{t.acceptExcluded}</span>
          </label>
          {sellsToBusinesses ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="b2bReturns" defaultChecked={settings.b2bReturns} className="mt-0.5 size-4" />
              <span>{t.b2b}</span>
            </label>
          ) : (
            // Kept as it is while Sell to businesses is off (D178).
            settings.b2bReturns && <input type="hidden" name="b2bReturns" value="on" />
          )}
        </section>

        <section aria-labelledby="address" className={card}>
          <h2 id="address" className="text-title text-ink">
            {t.address}
          </h2>
          <p className="text-sm text-muted">{t.addressText}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              {t.name}
              <input name="addressName" defaultValue={address?.name ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              {t.street}
              <input name="addressStreet" defaultValue={address?.street ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              {t.postalCode}
              <input name="addressPostalCode" defaultValue={address?.postalCode ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              {t.city}
              <input name="addressCity" defaultValue={address?.city ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              {t.country} <span className={hint}>{t.countryHint}</span>
              <input name="addressCountry" defaultValue={address?.country ?? ""} maxLength={2} autoComplete="off" className={`${input} uppercase sm:w-24`} />
            </label>
          </div>
        </section>

        <section aria-labelledby="instructions" className={card}>
          <h2 id="instructions" className="text-title text-ink">
            {t.instructions}
          </h2>
          <p className="text-sm text-muted">{t.instructionsText}</p>
          <label className={label}>
            {main.name} <span className={hint}>{t.mainLanguage}</span>
            <textarea name="instructions" defaultValue={settings.instructions} rows={5} maxLength={MAX_INSTRUCTIONS} className={`${input} py-2`} />
          </label>
          {others.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <p className="text-sm text-muted">
                {fillWords(t.others, { main: main.name })}{" "}
                <a href={translateHref} className="underline">
                  {t.translate}
                </a>
                {t.othersAfter}
              </p>
              {others.map((language) => (
                <label key={language.locale} className={label}>
                  {language.name}
                  <textarea name={`instructions:${language.locale}`} defaultValue={translations[language.locale] ?? ""} rows={4} maxLength={MAX_INSTRUCTIONS} lang={language.locale} className={`${input} py-2`} />
                </label>
              ))}
            </div>
          )}
        </section>
      </fieldset>

      {canEdit ? (
        <div>
          <SubmitButton>{t.save}</SubmitButton>
        </div>
      ) : (
        <p role="note" className="text-sm text-muted">
          {t.ownerOnly}
        </p>
      )}
    </ActionForm>
  );
}
