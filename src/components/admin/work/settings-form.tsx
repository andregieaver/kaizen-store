"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { WorkSettingsInput } from "@/lib/work-input";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

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

const card = "rounded-lg border border-line bg-card p-5";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal disabled:opacity-60";
const label = "flex max-w-md flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";

/**
 * How invoices say who is selling and how to pay, the defaults for new
 * clients and assignments, and when time runs out on an estimate. The seller's
 * name, address and organisation number are the Company page's; numbering has
 * its own form (`SeriesForm`), as the database guards it.
 */
export function WorkSettingsForm({ action, settings, currencies, mainCurrency, canEdit }: SettingsFormProps) {
  const tw = useAdminText("work").settingsForm;
  const [registered, setRegistered] = useState(settings.vatRegistered);
  return (
    <ActionForm action={action} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="flex flex-col gap-6">
        <section aria-labelledby="vat-heading" className={card}>
          <h2 id="vat-heading" className="mb-1 text-title text-ink">
            {tw.vatAndPaymentDetails}
          </h2>
          <p className="mb-4 text-sm text-muted">
            {tw.printedOnEveryInvoice}
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
                {tw.myBusinessIsRegistered}
                <span className={`block ${hint}`}>
                  {tw.invoicesChargeVatAt}
                </span>
              </span>
            </label>
            {registered && (
              <label className={label}>
                {tw.vatNumber}
                <input
                  name="vatNumber"
                  defaultValue={settings.vatNumber ?? ""}
                  autoComplete="off"
                  className={control}
                />
                <span className={hint}>{tw.forExampleNo123456789mvaOr}</span>
              </label>
            )}
            <label className={label}>
              {tw.bankAccount}
              <input
                name="bankAccount"
                defaultValue={settings.bankAccount ?? ""}
                autoComplete="off"
                className={control}
              />
              <span className={hint}>{tw.anIbanOrYour}</span>
            </label>
            <label className={label}>
              {tw.bicOptional}
              <input name="bic" defaultValue={settings.bic ?? ""} autoComplete="off" className={control} />
              <span className={hint}>{tw.theBankSCode}</span>
            </label>
            <label className={label}>
              {tw.howToPay}
              <textarea
                name="paymentNote"
                rows={3}
                maxLength={500}
                defaultValue={settings.paymentNote ?? ""}
                className={`${control} py-2`}
              />
              <span className={hint}>
                {tw.printedUnderTheBank}
              </span>
            </label>
            <label className={label}>
              {tw.invoiceFooter}
              <textarea
                name="invoiceFooter"
                rows={3}
                maxLength={1000}
                defaultValue={settings.invoiceFooter ?? ""}
                className={`${control} py-2`}
              />
              <span className={hint}>{tw.aLineAtThe}</span>
            </label>
            <label className={label}>
              {tw.latePaymentNote}
              <textarea
                name="latePaymentNote"
                rows={3}
                maxLength={1000}
                defaultValue={settings.latePaymentNote ?? ""}
                className={`${control} py-2`}
              />
              <span className={hint}>
                {tw.printedOnTheInvoice}
              </span>
            </label>
          </div>
        </section>

        <section aria-labelledby="defaults-heading" className={card}>
          <h2 id="defaults-heading" className="mb-1 text-title text-ink">
            {tw.defaults}
          </h2>
          <p className="mb-4 text-sm text-muted">{tw.usedWhenAClient}</p>
          <div className="flex flex-col gap-4">
            <label className={label}>
              {tw.daysToPay}
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
              <span className={hint}>{tw.theDueDateIs}</span>
            </label>
            <label className={label}>
              {tw.currency}
              <select name="defaultCurrency" defaultValue={settings.defaultCurrency ?? ""} className={control}>
                <option value="">Your store&apos;s main currency ({mainCurrency})</option>
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <span className={hint}>{tw.forNewClientsEach}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="showTimeNotesToClients"
                defaultChecked={settings.showTimeNotesToClients}
                className="mt-0.5 size-4"
              />
              <span>
                {tw.showClientsTheNotes}
                <span className={`block ${hint}`}>{tw.offByDefaultNotes}</span>
              </span>
            </label>
          </div>
        </section>

        <section aria-labelledby="estimates-heading" className={card}>
          <h2 id="estimates-heading" className="mb-1 text-title text-ink">
            {tw.estimateWarnings}
          </h2>
          <p className="mb-4 text-sm text-muted">
            {tw.whenATaskHas}
          </p>
          <div className="flex flex-col gap-4">
            <label className={label}>
              {tw.warnThisManyMinutes}
              <input
                name="estimateAlertMinutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={480}
                defaultValue={settings.estimateAlertMinutes ?? ""}
                className={`${control} max-w-40`}
              />
              <span className={hint}>{tw.leaveEmptyForNo}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="estimateAlertPopup"
                defaultChecked={settings.estimateAlertPopup}
                className="mt-0.5 size-4"
              />
              <span>{tw.showAMessageOn}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="estimateAlertSound"
                defaultChecked={settings.estimateAlertSound}
                className="mt-0.5 size-4"
              />
              <span>{tw.playASound}</span>
            </label>
          </div>
        </section>
      </fieldset>
      {canEdit ? (
        <div>
          <SubmitButton>{tw.saveSettings}</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted">{tw.onlyAnOwnerCan}</p>
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
  const tw = useAdminText("work").settingsForm;
  const locked = issued > 0;
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <h3 className="text-body-strong text-ink">{title}</h3>
      {locked ? (
        <p className="text-sm">
          {fillWords(tw.issuedLastIs, { count: issued })} <span className="font-medium">{lastDocumentNumber}</span>. {tw.nextWillBe}{" "}
          <span className="font-medium">{nextDocumentNumber}</span>.
          <span className={`block ${hint}`}>
            {tw.numbersAlreadyIssuedAre}
          </span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <label className={label}>
              {tw.prefix}
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
              {tw.nextNumber}
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
            {tw.theNextOneWill} <span className="font-medium text-ink">{nextDocumentNumber}</span>{tw.setTheNumberHere}
          </p>
          {canEdit && (
            <div>
              <SubmitButton>{tw.saveNumbering}</SubmitButton>
            </div>
          )}
        </>
      )}
    </ActionForm>
  );
}
