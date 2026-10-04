import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { FOOTER_NOTE_MAX, type SeriesName } from "@/lib/invoice-settings";
import { dayLabel, INVOICE_NOTES, SELLER_FIELD_LABELS } from "@/lib/invoice-admin";
import type { InvoiceReadiness, InvoiceSettings, SeriesState } from "@/server/invoice-settings";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

const SERIES_TITLES: Record<SeriesName, string> = { invoice: "Invoice numbers", credit_note: "Credit note numbers" };

/**
 * What is missing before invoices can be issued (D159, `docs/wave-1b-invoices.md` 2.3): the seller's details with a link to where each is
 * given, the tax profile, and the two things an owner should know before switching on (rates kept by hand, Stripe's own invoice).
 */
export function InvoiceReadinessList({ base, readiness }: { base: string; readiness: InvoiceReadiness }) {
  const items: { key: string; text: string; href: string | null }[] = [];
  for (const field of readiness.missing) {
    items.push({ key: field, text: `${SELLER_FIELD_LABELS[field] ?? field} is missing.`, href: `${base}${readiness.fixAt[field] ?? "/settings/company"}` });
  }
  if (!readiness.taxProfileSaved) items.push({ key: "tax", text: "The tax profile is not saved, so it is not known whether the store is registered for VAT.", href: `${base}/settings/tax` });
  return (
    <section aria-labelledby="readiness" className={card}>
      <h2 id="readiness" className="font-medium">
        Before you switch on
      </h2>
      {items.length === 0 ? (
        <p role="status" className="text-sm">
          The business details and the tax profile an invoice needs are complete.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Orders paid while something is missing wait for their invoice; the payment is never held back. They are issued, with that day as the issue date,
            within five minutes of the cause being put right.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0 flex-1">{item.text}</span>
                {item.href && (
                  <Link href={item.href} className="shrink-0 underline">
                    Fix it
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {readiness.ratesByHand && (
        <p className="text-sm text-muted">
          The store keeps its exchange rates by hand. An invoice in another currency than your country&apos;s shows the VAT in your country&apos;s currency at
          that rate, which the rules ask to come from the ECB or the central bank: ask your accountant, or switch on automatic rates under{" "}
          <Link href={`${base}/settings/localization`} className="underline">
            Languages and currencies
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
}: {
  settings: InvoiceSettings;
  readiness: InvoiceReadiness;
  paymentsHref: string;
  saveAction: Action;
}) {
  return (
    <ActionForm action={saveAction} successMessage="Saved." className="flex flex-col gap-6">
      <section aria-labelledby="switch" className={card}>
        <h2 id="switch" className="font-medium">
          Invoices
        </h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-0.5 size-4" />
          <span>
            Make an invoice for every paid order
            <span className={`block ${hint}`}>
              From the moment this is on. Orders paid before it was switched on are never invoiced afterwards.
              {settings.enabled && settings.enabledFrom ? ` Switched on ${dayLabel(settings.enabledFrom.slice(0, 10))}.` : ""}
              {!settings.enabled && settings.saved ? " It is off now, so new orders get no invoice." : ""}
            </span>
          </span>
        </label>
        {!settings.enabled && !readiness.ready && (
          <p className="text-sm text-muted">Complete the list above first, or orders will wait for their invoice once you switch it on.</p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="emailWithConfirmation" defaultChecked={settings.emailWithConfirmation} className="mt-0.5 size-4" />
          <span>
            Send the invoice with the order confirmation
            <span className={`block ${hint}`}>
              The email links to the invoice, and attaches the PDF when it exists. The invoice is always on the order page whatever you choose here.
            </span>
          </span>
        </label>
        {readiness.stripeInvoicesIgnored && (
          <p role="note" className="rounded-md border border-border bg-surface p-3 text-sm">
            Stripe&apos;s own invoice for orders is switched on under{" "}
            <Link href={paymentsHref} className="underline">
              Payments
            </Link>
            , and is not used while Kaizen makes the invoices, so a shopper never gets two.
          </p>
        )}
      </section>

      <section aria-labelledby="note" className={card}>
        <h2 id="note" className="font-medium">
          Note on every document
        </h2>
        <label className={label}>
          Text <span className={hint}>(up to {FOOTER_NOTE_MAX} characters, in the store&apos;s main language)</span>
          <textarea
            name="footerNote"
            defaultValue={settings.footerNote ?? ""}
            rows={4}
            maxLength={FOOTER_NOTE_MAX}
            className={`${input} min-h-24 py-2`}
          />
          <span className={hint}>
            Printed at the bottom of every invoice and credit note, for example the bank details or a returns address. Plain text only. It is not translated:
            it is shown as written on documents in every language, and a change applies to documents issued from then on.
          </span>
        </label>
      </section>

      <div>
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * One series' prefix and first number. Open until its first document is issued, then shown and locked: numbers already issued cannot be
 * changed, and the next one always follows the last.
 */
export function SeriesForm({ state, action }: { state: SeriesState; action: Action }) {
  const title = SERIES_TITLES[state.series];
  return (
    <section aria-labelledby={`series-${state.series}`} className={card}>
      <h2 id={`series-${state.series}`} className="font-medium">
        {title}
      </h2>
      {state.locked ? (
        <p className="text-sm">
          {state.issued} issued. The next number is <span className="font-medium">{state.nextDocumentNumber}</span>.
          <span className={`block ${hint}`}>Numbers already issued cannot be changed, and none can be skipped or removed.</span>
        </p>
      ) : (
        <ActionForm action={action} successMessage="Saved." className="flex flex-col gap-4">
          <input type="hidden" name="series" value={state.series} />
          <div className="flex flex-wrap gap-4">
            <label className={label}>
              Prefix <span className={hint}>(up to 10 letters, digits and . _ / -)</span>
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
              First number
              <input name="nextNumber" type="number" inputMode="numeric" min={1} step={1} defaultValue={state.nextNumber} className={`${input} sm:w-40`} />
            </label>
          </div>
          <p className="text-sm text-muted">
            The first {state.series === "invoice" ? "invoice" : "credit note"} will be <span className="font-medium text-foreground">{state.nextDocumentNumber}</span>. You can
            change this until it is issued; to continue numbers from another system, set the number after the last one you used there.
          </p>
          <div>
            <SubmitButton variant="secondary">Save the numbers</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}

/** The plain-English notes for an accountant's eyes. */
export function InvoiceNotes() {
  return (
    <section aria-labelledby="notes" className={card}>
      <h2 id="notes" className="font-medium">
        What the system does
      </h2>
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        {INVOICE_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <p className="text-sm text-muted">This is not legal, tax or accounting advice.</p>
    </section>
  );
}
