"use client";

import { useActionState, useState, useTransition } from "react";

import { checkoutAction, vatNumberAction, type CheckoutState } from "@/app/s/[store]/[market]/cart/actions";
import type { VatNumberMessage } from "@/lib/vat-text";
import type { CheckoutProblem } from "@/server/checkout";

import { VatNumberField, type VatNumberFieldLabels } from "./vat-number-field";

export type CheckoutLabels = {
  checkout: string;
  startingPayment: string;
  problems: Record<CheckoutProblem, string>;
};

/** What the shopper must agree to first: downloads (D24) or a subscription (D25). */
export type CheckoutConsents = { digital?: string; subscription?: string };

/**
 * The company a business buys for (B2B): asked for when the shopper buys as
 * a business (`ask`), required when the order needs it. Without `ask`, the
 * cart is for a private shopper and keeps no company.
 */
export type CheckoutCompany = {
  ask: boolean;
  required: boolean;
  name: string;
  number: string;
  labels: { legend: string; name: string; number: string; required: string; optional: string };
};

/**
 * The EU VAT number a business may give for reverse charge (D157), asked for under the company's fields where the cart
 * offers it. `initial` is the number as the cart holds it and `message` what the server says of it; `problems` are the
 * texts for what the action can refuse (`vatProblemTexts()`), `unsaved` for a number left unchecked that cannot be.
 */
export type CheckoutVat = {
  /** The field is drawn; false when only `note` is (the goods cannot take a number). */
  offered: boolean;
  initial: string;
  message: VatNumberMessage | null;
  labels: VatNumberFieldLabels;
  problems: Record<string, string>;
  /** One line when the cart's goods cannot take a number (a booking, a subscription): instead of the field. */
  note?: string | null;
};

const sameNumber = (a: string, b: string) =>
  a.replace(/[^0-9A-Za-z+*]/g, "").toUpperCase() === b.replace(/[^0-9A-Za-z+*]/g, "").toUpperCase();

/**
 * Who books, asked for when nothing is paid online (D66): Stripe asks
 * everyone else. Filled in from a signed-in customer.
 */
export type CheckoutContactFields = {
  name: string;
  email: string;
  phone: string;
  labels: { legend: string; name: string; email: string; phone: string };
};

/**
 * Sends the shopper to payment; stays put and explains if that is not
 * possible. With `consents`, the shopper first ticks each one: that
 * downloads start at once and end the right of withdrawal, and the terms of
 * a subscription.
 */
export function CheckoutButton({
  store,
  market,
  disabled,
  labels,
  consents = {},
  company,
  contact,
  vat,
}: {
  store: string;
  market: string;
  disabled: boolean;
  labels: CheckoutLabels;
  consents?: CheckoutConsents;
  /** On the cart page (B2B); the checkout page keeps what the cart has. */
  company?: CheckoutCompany;
  /** When the order is paid entirely at the venue (D66). */
  contact?: CheckoutContactFields;
  /** Where the cart offers a business's EU VAT number (D157); only with `company.ask`. */
  vat?: CheckoutVat;
}) {
  // Kept as typed: a form action resets its fields, and a mistyped number should not be lost.
  const [companyName, setCompanyName] = useState(company?.name ?? "");
  const [companyNumber, setCompanyNumber] = useState(company?.number ?? "");
  const [vatNumber, setVatNumber] = useState(vat?.initial ?? "");
  const [vatChecked, setVatChecked] = useState(vat?.initial ?? "");
  const [vatProblem, setVatProblem] = useState<string | null>(null);
  const [checkingVat, startVatCheck] = useTransition();
  const offersVat = Boolean(vat?.offered && company?.ask);

  /** Asks the server about the typed number (the company typed beside it is kept first); false when it could not be kept. */
  async function checkVat(): Promise<boolean> {
    if (!vat) return true;
    const result = await vatNumberAction(store, market, vatNumber, { name: companyName, number: companyNumber });
    const problem = vat.problems[result.outcome] ?? null;
    setVatProblem(problem);
    if (!problem) setVatChecked(vatNumber);
    return problem === null;
  }

  const [state, action, pending] = useActionState(
    async (_: CheckoutState, form: FormData): Promise<CheckoutState> => {
      // A number typed and not checked is checked first, so pressing pay never leaves it out. VIES being down is not a
      // problem here (VAT is charged and the sale goes on); only a number that cannot be asked about stops it.
      if (offersVat && !sameNumber(vatNumber, vatChecked) && !(await checkVat())) return { problem: null };
      return checkoutAction(
        store,
        market,
        {
          digital: form.get("digitalConsent") === "on",
          subscription: form.get("subscriptionConsent") === "on",
        },
        company === undefined
          ? undefined
          : company.ask
            ? { name: String(form.get("companyName") ?? ""), number: String(form.get("organisationNumber") ?? "") }
            : null,
        contact
          ? {
              name: String(form.get("contactName") ?? ""),
              email: String(form.get("contactEmail") ?? ""),
              phone: String(form.get("contactPhone") ?? ""),
            }
          : null,
      );
    },
    { problem: null },
  );
  const [who, setWho] = useState({ name: contact?.name ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "" });
  const field = "min-h-11 w-full rounded-md border border-border bg-background px-3";
  return (
    <form action={action} className="flex flex-col gap-3">
      {company?.ask && (
        <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{company.labels.legend}</legend>
          <p className="text-muted">{company.required ? company.labels.required : company.labels.optional}</p>
          <label className="flex flex-col gap-1">
            {company.labels.name}
            <input
              name="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required={company.required}
              maxLength={120}
              autoComplete="organization"
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            {company.labels.number}
            <input
              name="organisationNumber"
              value={companyNumber}
              onChange={(e) => setCompanyNumber(e.target.value)}
              required={company.required}
              maxLength={40}
              className={field}
            />
          </label>
          {offersVat && vat && (
            <VatNumberField
              value={vatNumber}
              onChange={(value) => {
                setVatNumber(value);
                setVatProblem(null);
              }}
              onCheck={() => startVatCheck(async () => void (await checkVat()))}
              checking={checkingVat}
              message={sameNumber(vatNumber, vat.initial) ? vat.message : null}
              problem={vatProblem}
              labels={vat.labels}
            />
          )}
          {company?.ask && vat?.note && <p className="text-muted">{vat.note}</p>}
        </fieldset>
      )}
      {contact && (
        <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{contact.labels.legend}</legend>
          {(
            [
              ["name", "contactName", contact.labels.name, "text", "name"],
              ["email", "contactEmail", contact.labels.email, "email", "email"],
              ["phone", "contactPhone", contact.labels.phone, "tel", "tel"],
            ] as const
          ).map(([key, name, text, type, autoComplete]) => (
            <label key={key} className="flex flex-col gap-1">
              {text}
              <input
                name={name}
                type={type}
                value={who[key]}
                onChange={(e) => setWho({ ...who, [key]: e.target.value })}
                required
                maxLength={key === "name" ? 120 : 200}
                autoComplete={autoComplete}
                className={field}
              />
            </label>
          ))}
        </fieldset>
      )}
      {(["subscription", "digital"] as const).map(
        (kind) =>
          consents[kind] && (
            <label key={kind} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name={`${kind}Consent`} required className="mt-0.5 size-4 shrink-0" />
              {consents[kind]}
            </label>
          ),
      )}
      <button
        type="submit"
        disabled={disabled || pending}
        className="min-h-12 button-primary px-4 font-medium disabled:opacity-40"
      >
        {pending ? labels.startingPayment : labels.checkout}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {state.problem && labels.problems[state.problem]}
      </p>
    </form>
  );
}
