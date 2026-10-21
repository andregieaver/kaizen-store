"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { checkoutAction, vatNumberAction, type CheckoutState } from "@/app/s/[store]/[market]/cart/actions";
import { payHeld, type TermsDisplay } from "@/lib/checkout-terms";
import type { VatNumberMessage } from "@/lib/vat-text";
import type { CheckoutProblem } from "@/server/checkout";

import { CheckoutTerms } from "./checkout-terms";
import { termsKey, useTicked } from "./terms-choice";
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
 * Who pays and where the goods go, asked when the store's checkout is Mollie's (D292), whose page asks for neither. Filled in from a signed-in customer;
 * the address only when goods are sent to the shopper, a phone number required when the store's own driver brings them.
 */
export type CheckoutPayerFields = {
  needs: { address: boolean; phone: boolean };
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  labels: {
    legend: string;
    name: string;
    email: string;
    phone: string;
    phoneOptional: string;
    address: string;
    line1: string;
    line2: string;
    postalCode: string;
    city: string;
    note: string;
  };
};

/**
 * Buying on the company's payment terms (D293): offered to a signed-in owner or employee of a company with terms, as a choice beside paying now (or as
 * the only way when the store takes no payments now). Chosen, who pays is asked with the billing address the invoice needs, the store's terms of sale
 * are shown as the checkout shows them, and the button places the order with nothing paid.
 */
export type CheckoutTermsChoice = {
  onlyWay: boolean;
  /** "Fjord AS has 30 days to pay. The invoice is due on 19 November 2026." */
  note: string;
  payNow: string;
  name: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  phoneNeeded: boolean;
  labels: { choice: string; legend: string; address: string; place: string; note: string };
  payerLabels: CheckoutPayerFields["labels"];
  /** The store's terms of sale (D158), or null when it shows none. */
  display: TermsDisplay | null;
  template: string;
  newTab: string;
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
  payer,
  vat,
  terms,
  cardsPayAll,
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
  /** When the store's checkout is Mollie's (D292). */
  payer?: CheckoutPayerFields;
  /** Where the cart offers a business's EU VAT number (D157); only with `company.ask`. */
  vat?: CheckoutVat;
  /** Where the signed-in buyer's company may buy on payment terms (D293). */
  terms?: CheckoutTermsChoice;
  /** Gift cards pay it all (D300 F3): no payment page follows, so the store's terms of sale are shown here and the button places the order. */
  cardsPayAll?: { display: TermsDisplay | null; template: string; newTab: string; place: string };
}) {
  const [way, setWay] = useState<"now" | "terms">(terms?.onlyWay ? "terms" : "now");
  const onTerms = Boolean(terms) && way === "terms";
  // On terms, who pays is asked with the billing address, whatever the store's provider would have asked.
  const shownPayer: CheckoutPayerFields | undefined =
    onTerms && terms
      ? {
          needs: { address: true, phone: terms.phoneNeeded },
          name: terms.name,
          email: terms.email,
          phone: terms.phone,
          line1: terms.line1,
          line2: terms.line2,
          postalCode: terms.postalCode,
          city: terms.city,
          labels: { ...terms.payerLabels, legend: terms.labels.legend, address: terms.labels.address, note: terms.labels.note },
        }
      : payer;
  const ticked = useTicked(termsKey(store, market));
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
        shownPayer
          ? {
              name: String(form.get("payerName") ?? ""),
              email: String(form.get("payerEmail") ?? ""),
              phone: String(form.get("payerPhone") ?? ""),
              line1: String(form.get("payerLine1") ?? ""),
              line2: String(form.get("payerLine2") ?? ""),
              postalCode: String(form.get("payerPostalCode") ?? ""),
              city: String(form.get("payerCity") ?? ""),
            }
          : null,
        onTerms ? { termsTicked: ticked } : null,
        cardsPayAll && !onTerms ? { termsTicked: ticked } : null,
      );
    },
    { problem: null },
  );
  // On to payment with a full page load (wave 1, 1e): nothing a page added earlier may be in the document where a card is typed.
  const to = state.to;
  useEffect(() => {
    if (to) window.location.assign(to);
  }, [to]);
  const [who, setWho] = useState({ name: contact?.name ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "" });
  // Kept as typed: a form action resets its fields.
  const filled = payer ?? terms;
  const [pays, setPays] = useState({
    name: filled?.name ?? "",
    email: filled?.email ?? "",
    phone: filled?.phone ?? "",
    line1: filled?.line1 ?? "",
    line2: filled?.line2 ?? "",
    postalCode: filled?.postalCode ?? "",
    city: filled?.city ?? "",
  });
  const field = "min-h-11 w-full rounded-md border border-border bg-background px-3";
  return (
    <form action={action} className="flex flex-col gap-3">
      {terms && !terms.onlyWay && (
        <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
          <legend className="sr-only">{terms.labels.choice}</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="way" value="now" checked={way === "now"} onChange={() => setWay("now")} className="mt-0.5 size-4 shrink-0" />
            {terms.payNow}
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="way" value="terms" checked={way === "terms"} onChange={() => setWay("terms")} className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">{terms.labels.choice}</span>
              <span className="block text-muted">{terms.note}</span>
            </span>
          </label>
        </fieldset>
      )}
      {terms?.onlyWay && (
        <p className="text-sm">
          <span className="font-medium">{terms.labels.choice}</span>
          <span className="block text-muted">{terms.note}</span>
        </p>
      )}
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
      {shownPayer && (
        <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{shownPayer.labels.legend}</legend>
          {(
            [
              ["name", "payerName", shownPayer.labels.name, "text", "name", true, 120],
              ["email", "payerEmail", shownPayer.labels.email, "email", "email", true, 200],
              ["phone", "payerPhone", shownPayer.needs.phone ? shownPayer.labels.phone : shownPayer.labels.phoneOptional, "tel", "tel", shownPayer.needs.phone, 40],
            ] as const
          ).map(([key, name, text, type, autoComplete, required, max]) => (
            <label key={key} className="flex flex-col gap-1">
              {text}
              <input
                name={name}
                type={type}
                value={pays[key]}
                onChange={(e) => setPays({ ...pays, [key]: e.target.value })}
                required={required}
                maxLength={max}
                autoComplete={autoComplete}
                className={field}
              />
            </label>
          ))}
          {shownPayer.needs.address && (
            <>
              <p className="mt-2 font-medium">{shownPayer.labels.address}</p>
              {(
                [
                  ["line1", "payerLine1", shownPayer.labels.line1, "address-line1", true, 200],
                  ["line2", "payerLine2", shownPayer.labels.line2, "address-line2", false, 200],
                  ["postalCode", "payerPostalCode", shownPayer.labels.postalCode, "postal-code", true, 20],
                  ["city", "payerCity", shownPayer.labels.city, "address-level2", true, 100],
                ] as const
              ).map(([key, name, text, autoComplete, required, max]) => (
                <label key={key} className="flex flex-col gap-1">
                  {text}
                  <input
                    name={name}
                    value={pays[key]}
                    onChange={(e) => setPays({ ...pays, [key]: e.target.value })}
                    required={required}
                    maxLength={max}
                    autoComplete={autoComplete}
                    className={field}
                  />
                </label>
              ))}
            </>
          )}
          <p className="text-muted">{shownPayer.labels.note}</p>
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
      {onTerms && terms?.display && <CheckoutTerms store={store} market={market} display={terms.display} template={terms.template} newTab={terms.newTab} />}
      {!onTerms && cardsPayAll?.display && (
        <CheckoutTerms store={store} market={market} display={cardsPayAll.display} template={cardsPayAll.template} newTab={cardsPayAll.newTab} />
      )}
      <button
        type="submit"
        disabled={
          disabled ||
          pending ||
          Boolean(to) ||
          (onTerms && payHeld(terms?.display ?? null, ticked)) ||
          (!onTerms && Boolean(cardsPayAll) && payHeld(cardsPayAll?.display ?? null, ticked))
        }
        className="min-h-12 button-primary px-4 font-medium disabled:opacity-40"
      >
        {pending || to ? labels.startingPayment : onTerms && terms ? terms.labels.place : cardsPayAll ? cardsPayAll.place : labels.checkout}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {state.problem && labels.problems[state.problem]}
      </p>
    </form>
  );
}
