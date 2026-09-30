"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { createClientAction, updateClientAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/actions";
import { clientPrefill, formatOrganisationNumber, type BrregCompany } from "@/lib/brreg";
import { documentLanguage, DOCUMENT_LANGUAGES } from "@/lib/work-invoice-text";
import { VAT_TREATMENTS, VAT_TREATMENT_LABELS, suggestTreatment, type VatTreatment } from "@/lib/work-vat";
import { NO_PROBLEMS, clientPayload, moneyField, type ClientFormValues, type FormProblems } from "@/lib/work-ui";
import type { WorkClient } from "@/server/work";

import { BrregLookup } from "./brreg-lookup";
import { Field, Problems, control, hintText, primaryButton, secondaryButton } from "./work-parts";

const LANGUAGE_NAMES: Record<(typeof DOCUMENT_LANGUAGES)[number], string> = {
  nb: "Norwegian",
  sv: "Swedish",
  da: "Danish",
  en: "English",
};

export type ClientFormProps = {
  storeSlug: string;
  /** The client being changed; none makes a new one. */
  client?: WorkClient;
  countries: { code: string; name: string }[];
  currencies: string[];
  /** What a new client starts with (`formDefaults`). */
  defaults: { currency: string; locale: string; paymentDays: number };
  /** The seller's country, to suggest the client's VAT treatment. */
  sellerCountry: string | null;
  /** Called with the client's id once it is saved. */
  onDone?: (id: string) => void;
  onCancel?: () => void;
};

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * A client: who is billed, where, in which currency and at what hourly rate,
 * how VAT is treated and how long they have to pay. Everything an invoice
 * later says about the buyer comes from here, and an invoice already issued
 * keeps what it was issued with. Sent as JSON and checked by `clientInput` in
 * the browser and again on the server; what was typed stays when something is
 * wrong.
 */
export function ClientForm({
  storeSlug,
  client,
  countries,
  currencies,
  defaults,
  sellerCountry,
  onDone,
  onCancel,
}: ClientFormProps) {
  const editing = client !== undefined;
  const currency = client?.currency ?? defaults.currency;
  const localeOptions: string[] = [...DOCUMENT_LANGUAGES];
  const startLocale = client?.locale ?? documentLanguage(defaults.locale);
  if (!localeOptions.includes(startLocale)) localeOptions.push(startLocale);

  const [business, setBusiness] = useState(client?.business ?? true);
  const [treatment, setTreatment] = useState<VatTreatment>(client?.vatTreatment ?? "domestic");
  const [country, setCountry] = useState(client?.country ?? sellerCountry ?? "");
  const [vatNumber, setVatNumber] = useState(client?.vatNumber ?? "");
  // What the company register can fill in is held here so a lookup can write it; the rest of the form is read on save.
  const [name, setName] = useState(client?.name ?? "");
  const [legalName, setLegalName] = useState(client?.legalName ?? "");
  const [organisationNumber, setOrganisationNumber] = useState(client?.organisationNumber ?? "");
  const [line1, setLine1] = useState(client?.billingAddress.line1 ?? "");
  const [line2, setLine2] = useState(client?.billingAddress.line2 ?? "");
  const [postalCode, setPostalCode] = useState(client?.billingAddress.postalCode ?? "");
  const [city, setCity] = useState(client?.billingAddress.city ?? "");
  const [locale, setLocale] = useState<string>(startLocale);
  const [fromRegister, setFromRegister] = useState<BrregCompany | null>(null);
  const [problems, setProblems] = useState<FormProblems>(NO_PROBLEMS);
  const [attempt, setAttempt] = useState(0);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // A form that does not pass takes the person to the first field that needs another look.
  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  // A company picked in the register: its details go into the form. The name the person gave is kept if there is one.
  const fill = (company: BrregCompany) => {
    const fields = clientPrefill(company);
    if (name.trim() === "") setName(fields.name);
    setLegalName(fields.legalName);
    setOrganisationNumber(formatOrganisationNumber(fields.organisationNumber));
    setLine1(fields.line1);
    setLine2(fields.line2);
    setPostalCode(fields.postalCode);
    setCity(fields.city);
    setCountry(fields.country);
    setBusiness(true);
    if (fields.vatNumber) setVatNumber(fields.vatNumber);
    if (localeOptions.includes(fields.locale)) setLocale(fields.locale);
    setFromRegister(company);
  };

  const suggested =
    business && sellerCountry
      ? suggestTreatment({
          sellerCountry,
          clientCountry: country || null,
          business,
          clientVatNumber: vatNumber,
        })
      : "domestic";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: ClientFormValues = {
      name: text(form, "name"),
      legalName: text(form, "legalName"),
      organisationNumber: text(form, "organisationNumber"),
      vatNumber: text(form, "vatNumber"),
      country: text(form, "country"),
      line1: text(form, "line1"),
      line2: text(form, "line2"),
      postalCode: text(form, "postalCode"),
      city: text(form, "city"),
      billingEmail: text(form, "billingEmail"),
      contactName: text(form, "contactName"),
      phone: text(form, "phone"),
      locale: text(form, "locale"),
      currency: text(form, "currency"),
      hourlyRate: text(form, "hourlyRate"),
      paymentDays: text(form, "paymentDays"),
      business: form.get("business") === "on",
      vatTreatment: text(form, "vatTreatment") || "domestic",
      usePrepaid: client?.usePrepaid ?? true,
      notes: text(form, "notes"),
      // The link to a customer is made elsewhere; saving keeps it.
      customerCompanyId: client?.customerCompanyId ?? null,
      customerId: client?.customerId ?? null,
    };
    const payload = clientPayload(values);
    if (!payload.ok) {
      setProblems(payload.problems);
      setAttempt((count) => count + 1);
      return;
    }
    setProblems(NO_PROBLEMS);
    start(async () => {
      try {
        if (client) {
          const result = await updateClientAction(storeSlug, client.id, payload.input);
          if (!result.ok) setProblems({ fields: {}, general: result.problems });
          else onDone?.(client.id);
        } else {
          const result = await createClientAction(storeSlug, payload.input);
          if (!result.ok) setProblems({ fields: {}, general: result.problems });
          else onDone?.(result.id);
        }
      } catch {
        setProblems({
          fields: {},
          general: ["The client could not be saved. Check your connection and try again."],
        });
      }
    });
  };

  const err = (name: string) => problems.fields[name];
  // The messages under fields are read with them; the alert holds only what belongs to none, and says there is more.
  const summary = [
    ...problems.general,
    ...(Object.keys(problems.fields).length > 0 ? ["Some fields need another look. They are marked below."] : []),
  ];

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BrregLookup storeSlug={storeSlug} onPick={fill} />
        {fromRegister && (
          <div role="status" className="rounded-md border border-border px-3 py-2 text-sm">
            <p>
              Filled in from the register: {fromRegister.legalName},{" "}
              {formatOrganisationNumber(fromRegister.organisationNumber)}
              {fromRegister.organisationFormName ? ` (${fromRegister.organisationFormName})` : ""}. Check the details
              below before you save.
            </p>
            {!fromRegister.vatRegistered && (
              <p className={hintText}>Not in the VAT register, so no VAT number was filled in.</p>
            )}
            {!fromRegister.address && (
              <p className={hintText}>The register has no address for this company: fill it in yourself.</p>
            )}
            {fromRegister.warnings.map((warning) => (
              <p key={warning} className="font-medium text-red-700 dark:text-red-400">
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">Client</legend>
        <Field label="Name" error={err("name")} hint="What you call them. Shown in lists and on time reports.">
          {(props) => (
            <input
              {...props}
              name="name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person" error={err("contactName")}>
            {(props) => (
              <input
                {...props}
                name="contactName"
                maxLength={120}
                defaultValue={client?.contactName ?? ""}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Phone" error={err("phone")}>
            {(props) => (
              <input
                {...props}
                name="phone"
                type="tel"
                maxLength={40}
                defaultValue={client?.phone ?? ""}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
        <Field label="Invoice email" error={err("billingEmail")} hint="Where invoices are sent.">
          {(props) => (
            <input
              {...props}
              name="billingEmail"
              type="email"
              maxLength={200}
              defaultValue={client?.billingEmail ?? ""}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">Billing details</legend>
        <p className={hintText}>
          Printed on invoices under Bill to. An invoice cannot be issued without an address and a country.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" error={err("legalName")} hint="If it differs from the name above.">
            {(props) => (
              <input
                {...props}
                name="legalName"
                maxLength={200}
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Organisation number" error={err("organisationNumber")}>
            {(props) => (
              <input
                {...props}
                name="organisationNumber"
                maxLength={40}
                value={organisationNumber}
                onChange={(event) => setOrganisationNumber(event.target.value)}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
        <Field label="Address" error={err("line1")}>
          {(props) => (
            <input
              {...props}
              name="line1"
              maxLength={200}
              value={line1}
              onChange={(event) => setLine1(event.target.value)}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="Address line 2" error={err("line2")}>
          {(props) => (
            <input
              {...props}
              name="line2"
              maxLength={200}
              value={line2}
              onChange={(event) => setLine2(event.target.value)}
              className={control}
              autoComplete="off"
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Postal code" error={err("postalCode")}>
            {(props) => (
              <input
                {...props}
                name="postalCode"
                maxLength={20}
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="City" error={err("city")}>
            {(props) => (
              <input
                {...props}
                name="city"
                maxLength={100}
                value={city}
                onChange={(event) => setCity(event.target.value)}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" error={err("country")}>
            {(props) => (
              <select
                {...props}
                name="country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                className={control}
              >
                <option value="">Not set</option>
                {countries.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="VAT number" error={err("vatNumber")} hint="With the country code, such as SE556677889901.">
            {(props) => (
              <input
                {...props}
                name="vatNumber"
                maxLength={40}
                value={vatNumber}
                onChange={(event) => setVatNumber(event.target.value)}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">Rates and terms</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency" error={err("currency")}>
            {(props) => (
              <select {...props} name="currency" defaultValue={currency} className={control}>
                {(currencies.includes(currency) ? currencies : [currency, ...currencies]).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Hourly rate"
            error={err("hourlyRate")}
            hint="Without VAT. Assignments use it unless they have their own."
          >
            {(props) => (
              <input
                {...props}
                name="hourlyRate"
                inputMode="decimal"
                defaultValue={moneyField(client?.defaultHourlyRateMinor, currency)}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            label="Days to pay"
            error={err("paymentDays")}
            hint={`Empty uses your default, ${defaults.paymentDays}.`}
          >
            {(props) => (
              <input
                {...props}
                name="paymentDays"
                inputMode="numeric"
                defaultValue={client?.paymentDays ?? ""}
                placeholder={String(defaults.paymentDays)}
                className={control}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
        <Field
          label="Language of their invoices"
          error={err("locale")}
          hint="Invoices and emails to this client are written in it. Other languages are sent in English."
        >
          {(props) => (
            <select
              {...props}
              name="locale"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              className={control}
            >
              {localeOptions.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAMES[code as keyof typeof LANGUAGE_NAMES] ?? code}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">VAT</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="business"
            checked={business}
            onChange={(event) => {
              setBusiness(event.target.checked);
              if (!event.target.checked) setTreatment("domestic");
            }}
            className="mt-0.5 size-4"
          />
          <span>
            A business
            <span className={`block ${hintText}`}>
              A private customer is always charged VAT at your country&apos;s rate.
            </span>
          </span>
        </label>
        <Field label="VAT treatment" error={err("vatTreatment")} hint={VAT_TREATMENT_LABELS[treatment].hint}>
          {(props) => (
            <select
              {...props}
              name="vatTreatment"
              value={treatment}
              disabled={!business}
              onChange={(event) => setTreatment(event.target.value as VatTreatment)}
              className={control}
            >
              {VAT_TREATMENTS.map((value) => (
                <option key={value} value={value}>
                  {VAT_TREATMENT_LABELS[value].label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {business && suggested !== treatment && (
          <p className="text-sm">
            For a business in this country, {VAT_TREATMENT_LABELS[suggested].label.toLowerCase()} is usual.{" "}
            <button type="button" onClick={() => setTreatment(suggested)} className="underline">
              Use {VAT_TREATMENT_LABELS[suggested].label.toLowerCase()}
            </button>
          </p>
        )}
      </fieldset>

      <Field label="Notes" error={err("notes")} hint="For you. Not printed on invoices.">
        {(props) => (
          <textarea
            {...props}
            name="notes"
            rows={3}
            maxLength={4000}
            defaultValue={client?.notes ?? ""}
            className={`${control} py-2`}
          />
        )}
      </Field>

      <Problems messages={summary} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving …" : editing ? "Save client" : "Add client"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
