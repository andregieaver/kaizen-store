"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { WorkSettingsInput } from "@/lib/work-input";

/** The settings the form edits: `work_settings`, as `getWorkSettings` reads them. */
export type SettingsFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  settings: WorkSettingsInput;
  /** The currencies the store can offer, and the store's own main one (what an empty choice means). */
  currencies: string[];
  mainCurrency: string;
  /** Only owners change Work's settings (VAT registration and bank details are legal facts). */
  canEdit: boolean;
};

const card = "rounded-lg border border-border bg-background p-5";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal disabled:opacity-60";
const label = "flex max-w-md flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";

/**
 * How invoices say who is selling and how to pay, the defaults for new
 * clients and assignments, and when time runs out on an estimate. The seller's
 * name, address and organisation number are the Company page's; numbering has
 * its own form (`SeriesForm`), as the database guards it.
 */
export function WorkSettingsForm({ action, settings, currencies, mainCurrency, canEdit }: SettingsFormProps) {
  const [registered, setRegistered] = useState(settings.vatRegistered);
  return (
    <ActionForm action={action} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="flex flex-col gap-6">
        <section aria-labelledby="vat-heading" className={card}>
          <h2 id="vat-heading" className="mb-1 font-medium">
            VAT and payment details
          </h2>
          <p className="mb-4 text-sm text-muted">
            Printed on every invoice. The law asks for these, so an invoice cannot be issued without them.
          </p>
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="vatRegistered"
                checked={registered}
                onChange={(event) => setRegistered(event.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                My business is registered for VAT
                <span className={`block ${hint}`}>
                  Invoices charge VAT at your country&apos;s rate. Leave it off if you are not registered: invoices then
                  charge no VAT and say so.
                </span>
              </span>
            </label>
            {registered && (
              <label className={label}>
                VAT number
                <input
                  name="vatNumber"
                  defaultValue={settings.vatNumber ?? ""}
                  autoComplete="off"
                  className={control}
                />
                <span className={hint}>For example NO123456789MVA or SE123456789001.</span>
              </label>
            )}
            <label className={label}>
              Bank account
              <input
                name="bankAccount"
                defaultValue={settings.bankAccount ?? ""}
                autoComplete="off"
                className={control}
              />
              <span className={hint}>An IBAN, or your country&apos;s own account number. Clients pay to this.</span>
            </label>
            <label className={label}>
              BIC (optional)
              <input name="bic" defaultValue={settings.bic ?? ""} autoComplete="off" className={control} />
              <span className={hint}>The bank&apos;s code, 8 or 11 characters. Useful for clients abroad.</span>
            </label>
            <label className={label}>
              How to pay
              <textarea
                name="paymentNote"
                rows={3}
                maxLength={500}
                defaultValue={settings.paymentNote ?? ""}
                className={`${control} py-2`}
              />
              <span className={hint}>
                Printed under the bank details: a payment reference, KID, or anything clients should know.
              </span>
            </label>
            <label className={label}>
              Invoice footer
              <textarea
                name="invoiceFooter"
                rows={3}
                maxLength={1000}
                defaultValue={settings.invoiceFooter ?? ""}
                className={`${control} py-2`}
              />
              <span className={hint}>A line at the bottom of every invoice, such as your terms.</span>
            </label>
            <label className={label}>
              Late payment note
              <textarea
                name="latePaymentNote"
                rows={3}
                maxLength={1000}
                defaultValue={settings.latePaymentNote ?? ""}
                className={`${control} py-2`}
              />
              <span className={hint}>
                Printed on the invoice. Kaizen adds no interest or fees by itself: write only what you are entitled to.
              </span>
            </label>
          </div>
        </section>

        <section aria-labelledby="defaults-heading" className={card}>
          <h2 id="defaults-heading" className="mb-1 font-medium">
            Defaults
          </h2>
          <p className="mb-4 text-sm text-muted">Used when a client or an invoice does not say otherwise.</p>
          <div className="flex flex-col gap-4">
            <label className={label}>
              Days to pay
              <input
                name="defaultPaymentDays"
                type="number"
                inputMode="numeric"
                min={1}
                max={90}
                defaultValue={settings.defaultPaymentDays}
                required
                className={`${control} max-w-40`}
              />
              <span className={hint}>The due date is the day you issue the invoice plus this many days (1 to 90).</span>
            </label>
            <label className={label}>
              Currency
              <select name="defaultCurrency" defaultValue={settings.defaultCurrency ?? ""} className={control}>
                <option value="">Your store&apos;s main currency ({mainCurrency})</option>
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <span className={hint}>For new clients. Each client can have their own.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="showTimeNotesToClients"
                defaultChecked={settings.showTimeNotesToClients}
                className="mt-0.5 size-4"
              />
              <span>
                Show clients the notes on my time entries
                <span className={`block ${hint}`}>Off by default. Notes are for you unless you switch this on.</span>
              </span>
            </label>
          </div>
        </section>

        <section aria-labelledby="estimates-heading" className={card}>
          <h2 id="estimates-heading" className="mb-1 font-medium">
            Estimate warnings
          </h2>
          <p className="mb-4 text-sm text-muted">
            When a task has an estimate, you are told as it runs out. New assignments start with these; each can change
            them.
          </p>
          <div className="flex flex-col gap-4">
            <label className={label}>
              Warn this many minutes before the estimate is used up
              <input
                name="estimateAlertMinutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={480}
                defaultValue={settings.estimateAlertMinutes ?? ""}
                className={`${control} max-w-40`}
              />
              <span className={hint}>Leave empty for no warnings (1 to 480).</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="estimateAlertPopup"
                defaultChecked={settings.estimateAlertPopup}
                className="mt-0.5 size-4"
              />
              <span>Show a message on the page</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="estimateAlertSound"
                defaultChecked={settings.estimateAlertSound}
                className="mt-0.5 size-4"
              />
              <span>Play a sound</span>
            </label>
          </div>
        </section>
      </fieldset>
      {canEdit ? (
        <div>
          <SubmitButton>Save settings</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted">Only an owner can change Work&apos;s settings.</p>
      )}
    </ActionForm>
  );
}

/** One numbering series: its prefix and the next number, editable until the first document is issued in it. */
export function SeriesForm({
  action,
  title,
  prefix,
  nextNumber,
  issued,
  lastDocumentNumber,
  nextDocumentNumber,
  canEdit,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  title: string;
  prefix: string;
  nextNumber: number;
  issued: number;
  lastDocumentNumber: string | null;
  nextDocumentNumber: string;
  canEdit: boolean;
}) {
  const locked = issued > 0;
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      {locked ? (
        <p className="text-sm">
          {issued} issued, the last is <span className="font-medium">{lastDocumentNumber}</span>. The next will be{" "}
          <span className="font-medium">{nextDocumentNumber}</span>.
          <span className={`block ${hint}`}>
            Numbers already issued are never reused, so this can no longer be changed.
          </span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <label className={label}>
              Prefix
              <input
                name="prefix"
                defaultValue={prefix}
                maxLength={10}
                autoComplete="off"
                disabled={!canEdit}
                className={`${control} w-32`}
              />
            </label>
            <label className={label}>
              Next number
              <input
                name="nextNumber"
                type="number"
                inputMode="numeric"
                min={1}
                defaultValue={nextNumber}
                required
                disabled={!canEdit}
                className={`${control} w-40`}
              />
            </label>
          </div>
          <p className={`text-sm ${hint}`}>
            The next one will be <span className="font-medium text-foreground">{nextDocumentNumber}</span>. Set the
            number here before your first one if you continue numbers from another system.
          </p>
          {canEdit && (
            <div>
              <SubmitButton>Save numbering</SubmitButton>
            </div>
          )}
        </>
      )}
    </ActionForm>
  );
}
