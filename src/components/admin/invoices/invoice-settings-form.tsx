import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { invoicesEn, type InvoicesMessages } from "@/lib/admin-messages/invoices.en";
import { FOOTER_NOTE_MAX } from "@/lib/invoice-settings";
import { dayLabel, sellerFieldLabel } from "@/lib/invoice-admin";
import type { InvoiceReadiness, InvoiceSettings, SeriesState } from "@/server/invoice-settings";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";


/**
 * What is missing before invoices can be issued (D159, `docs/wave-1b-invoices.md` 2.3): the seller's details with a link to where each is
 * given, the tax profile, and the two things an owner should know before switching on (rates kept by hand, Stripe's own invoice).
 */
export function InvoiceReadinessList({ base, readiness, words: w = invoicesEn }: { base: string; readiness: InvoiceReadiness; words?: InvoicesMessages }) {
  const t = w.settings;
  const items: { key: string; text: string; href: string | null }[] = [];
  for (const field of readiness.missing) {
    items.push({ key: field, text: fillWords(t.missing, { field: sellerFieldLabel(field, w) }), href: `${base}${readiness.fixAt[field] ?? "/settings/company"}` });
  }
  if (!readiness.taxProfileSaved) items.push({ key: "tax", text: t.taxMissing, href: `${base}/settings/tax` });
  return (
    <section aria-labelledby="readiness" className={card}>
      <h2 id="readiness" className="text-title text-ink">
        {t.before}
      </h2>
      {items.length === 0 ? (
        <p role="status" className="text-sm">
          {t.complete}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">{t.waitText}</p>
          <ul className="divide-y divide-line rounded-panel border border-line text-sm">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning-solid" />
                <span className="min-w-0 flex-1">{item.text}</span>
                {item.href && (
                  <Link href={item.href} className="shrink-0 underline">
                    {t.fixIt}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {readiness.ratesByHand && (
        <p className="text-sm text-muted">
          {t.ratesByHand}{" "}
          <Link href={`${base}/settings/localization`} className="underline">
            {t.languagesAndCurrencies}
          </Link>
          .
        </p>
      )}
    </section>
  );
}

/** The switch, the confirmation-email option and the note printed on every document. Owners only (the action checks again). */
export function InvoiceSettingsForm({
  settings,
  readiness,
  paymentsHref,
  saveAction,
  words: w = invoicesEn,
}: {
  settings: InvoiceSettings;
  readiness: InvoiceReadiness;
  paymentsHref: string;
  saveAction: Action;
  words?: InvoicesMessages;
}) {
  const t = w.settings;
  return (
    <ActionForm action={saveAction} successMessage={t.saved} className="flex flex-col gap-6">
      <section aria-labelledby="switch" className={card}>
        <h2 id="switch" className="text-title text-ink">
          {t.invoices}
        </h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-0.5 size-4" />
          <span>
            {t.makeInvoice}
            <span className={`block ${hint}`}>
              {t.fromNow}
              {settings.enabled && settings.enabledFrom ? fillWords(t.switchedOn, { day: dayLabel(settings.enabledFrom.slice(0, 10), w) }) : ""}
              {!settings.enabled && settings.saved ? t.offNow : ""}
            </span>
          </span>
        </label>
        {!settings.enabled && !readiness.ready && (
          <p className="text-sm text-muted">{t.completeFirst}</p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="emailWithConfirmation" defaultChecked={settings.emailWithConfirmation} className="mt-0.5 size-4" />
          <span>
            {t.withConfirmation}
            <span className={`block ${hint}`}>{t.withConfirmationHint}</span>
          </span>
        </label>
        {readiness.stripeInvoicesIgnored && (
          <p role="note" className="rounded-md border border-line bg-sunken p-3 text-sm">
            {t.stripeBefore}{" "}
            <Link href={paymentsHref} className="underline">
              {t.payments}
            </Link>
            {t.stripeAfter}
          </p>
        )}
      </section>

      <section aria-labelledby="note" className={card}>
        <h2 id="note" className="text-title text-ink">
          {t.note}
        </h2>
        <label className={label}>
          {t.text} <span className={hint}>{fillWords(t.textHint, { max: FOOTER_NOTE_MAX })}</span>
          <textarea
            name="footerNote"
            defaultValue={settings.footerNote ?? ""}
            rows={4}
            maxLength={FOOTER_NOTE_MAX}
            className={`${input} min-h-24 py-2`}
          />
          <span className={hint}>{t.noteHint}</span>
        </label>
      </section>

      <div>
        <SubmitButton>{t.save}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * One series' prefix and first number. Open until its first document is issued, then shown and locked: numbers already issued cannot be
 * changed, and the next one always follows the last.
 */
export function SeriesForm({ state, action, words: w = invoicesEn }: { state: SeriesState; action: Action; words?: InvoicesMessages }) {
  const t = w.settings;
  const title = t.series[state.series];
  return (
    <section aria-labelledby={`series-${state.series}`} className={card}>
      <h2 id={`series-${state.series}`} className="text-title text-ink">
        {title}
      </h2>
      {state.locked ? (
        <p className="text-sm">
          {fillWords(t.issued, { n: state.issued })} <span className="font-medium">{state.nextDocumentNumber}</span>.
          <span className={`block ${hint}`}>{t.locked}</span>
        </p>
      ) : (
        <ActionForm action={action} successMessage={t.saved} className="flex flex-col gap-4">
          <input type="hidden" name="series" value={state.series} />
          <div className="flex flex-wrap gap-4">
            <label className={label}>
              {t.prefix} <span className={hint}>{t.prefixHint}</span>
              <input
                name="prefix"
                defaultValue={state.prefix}
                maxLength={10}
                autoComplete="off"
                spellCheck={false}
                className={`${input} font-mono sm:w-40`}
              />
            </label>
            <label className={label}>
              {t.firstNumber}
              <input name="nextNumber" type="number" inputMode="numeric" min={1} step={1} defaultValue={state.nextNumber} className={`${input} sm:w-40`} />
            </label>
          </div>
          <p className="text-sm text-muted">
            {state.series === "invoice" ? t.firstInvoice : t.firstCreditNote} <span className="font-medium text-ink">{state.nextDocumentNumber}</span>
            {t.firstAfter}
          </p>
          <div>
            <SubmitButton variant="secondary">{t.saveNumbers}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}

/** The plain-English notes for an accountant's eyes. */
export function InvoiceNotes({ words: w = invoicesEn }: { words?: InvoicesMessages }) {
  return (
    <section aria-labelledby="notes" className={card}>
      <h2 id="notes" className="text-title text-ink">
        {w.settings.notesTitle}
      </h2>
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        {w.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <p className="text-sm text-muted">{w.settings.notAdvice}</p>
    </section>
  );
}
