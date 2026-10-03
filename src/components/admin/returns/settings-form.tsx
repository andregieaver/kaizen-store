import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { InstructionTranslations } from "@/lib/return-instructions";
import { MAX_INSTRUCTIONS, MAX_TRANSIT_DAYS, MAX_WINDOW_DAYS, MIN_WINDOW_DAYS, type ReturnSettings } from "@/lib/withdrawal";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm disabled:opacity-60";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

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
}: {
  settings: ReturnSettings;
  translations: InstructionTranslations;
  main: SettingsLanguage;
  others: SettingsLanguage[];
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** `/admin/{store}/translate`, where AI can suggest the translations. */
  translateHref: string;
}) {
  const address = settings.returnAddress;
  return (
    <ActionForm action={action} successMessage="Saved." className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="window" className={card}>
          <h2 id="window" className="font-medium">
            How long customers have
          </h2>
          <p className="text-sm text-muted">
            The law gives every consumer {MIN_WINDOW_DAYS} days to change their mind about what they bought, and you cannot shorten that. If you give
            more, the days beyond are your own offer: a customer asks for a return, and you may approve or decline it.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Return window (days) <span className={hint}>{MIN_WINDOW_DAYS} to {MAX_WINDOW_DAYS}</span>
              <input name="windowDays" type="number" inputMode="numeric" min={MIN_WINDOW_DAYS} max={MAX_WINDOW_DAYS} defaultValue={settings.windowDays} required className={input} />
            </label>
            <label className={label}>
              Transit allowance (days) <span className={hint}>0 to {MAX_TRANSIT_DAYS}</span>
              <input name="transitDays" type="number" inputMode="numeric" min={0} max={MAX_TRANSIT_DAYS} defaultValue={settings.transitDays} required className={input} />
              <span className={hint}>
                When goods were sent but nobody marked them delivered, the {MIN_WINDOW_DAYS} days start this many days after they were sent. It is your
                estimate of how long delivery takes.
              </span>
            </label>
          </div>
        </section>

        <section aria-labelledby="money" className={card}>
          <h2 id="money" className="font-medium">
            Who pays, and when
          </h2>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Return shipping</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="whoPaysReturn" value="shopper" defaultChecked={settings.whoPaysReturn === "shopper"} className="mt-0.5 size-4" />
              <span>The customer pays to send the goods back. This is the default in the law, if you tell them before they buy.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="whoPaysReturn" value="store" defaultChecked={settings.whoPaysReturn === "store"} className="mt-0.5 size-4" />
              <span>The store pays.</span>
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">When refunds are made</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="refundWhen" value="received" defaultChecked={settings.refundWhen === "received"} className="mt-0.5 size-4" />
              <span>
                When the goods are back, or the customer shows proof that they sent them. The law allows this. The refund is still due within 14 days
                of being told about the withdrawal.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="refundWhen" value="request" defaultChecked={settings.refundWhen === "request"} className="mt-0.5 size-4" />
              <span>As soon as the customer asks, before the goods arrive.</span>
            </label>
          </fieldset>
        </section>

        <section aria-labelledby="scope" className={card}>
          <h2 id="scope" className="font-medium">
            What can come back
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="acceptExcluded" defaultChecked={settings.acceptExcluded} className="mt-0.5 size-4" />
            <span>
              Also accept returns of goods the law excludes from withdrawal, such as made-to-order goods or opened hygiene products. They are only
              ever return requests you may decline, and only inside your own window.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="b2bReturns" defaultChecked={settings.b2bReturns} className="mt-0.5 size-4" />
            <span>Also accept return requests from companies. A company has no legal right of withdrawal, so this is your own offer.</span>
          </label>
        </section>

        <section aria-labelledby="address" className={card}>
          <h2 id="address" className="font-medium">
            Where goods are sent back
          </h2>
          <p className="text-sm text-muted">Leave all of it empty to use the store&apos;s postal address, from its company details.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Name
              <input name="addressName" defaultValue={address?.name ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              Street
              <input name="addressStreet" defaultValue={address?.street ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              Postal code
              <input name="addressPostalCode" defaultValue={address?.postalCode ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              City
              <input name="addressCity" defaultValue={address?.city ?? ""} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              Country <span className={hint}>(two letters, such as NO)</span>
              <input name="addressCountry" defaultValue={address?.country ?? ""} maxLength={2} autoComplete="off" className={`${input} uppercase sm:w-24`} />
            </label>
          </div>
        </section>

        <section aria-labelledby="instructions" className={card}>
          <h2 id="instructions" className="font-medium">
            Instructions for customers
          </h2>
          <p className="text-sm text-muted">
            How to pack and send the goods back. Customers read this on their withdrawal and in the emails they get. Do not put legal promises in
            it: it is practical help.
          </p>
          <label className={label}>
            {main.name} <span className={hint}>(the store&apos;s main language)</span>
            <textarea name="instructions" defaultValue={settings.instructions} rows={5} maxLength={MAX_INSTRUCTIONS} className={`${input} py-2`} />
          </label>
          {others.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted">
                A text for each of the other languages. Where there is none, customers read the {main.name} text. You can have AI suggest them from{" "}
                <a href={translateHref} className="underline">
                  Translate the store
                </a>
                ; you read each one before it is kept.
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
          <SubmitButton>Save the return rules</SubmitButton>
        </div>
      ) : (
        <p role="note" className="text-sm text-muted">
          Only an owner can change these rules.
        </p>
      )}
    </ActionForm>
  );
}
