"use client";

import { useActionState, useEffect, useState } from "react";

import { checkoutAction, type CheckoutState } from "@/app/s/[store]/[market]/cart/actions";
import type { CheckoutProblem } from "@/server/checkout";

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
}) {
  const [state, action, pending] = useActionState(
    async (_: CheckoutState, form: FormData): Promise<CheckoutState> =>
      checkoutAction(
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
      ),
    { problem: null },
  );
  // On to payment with a full page load (wave 1, 1e): nothing a page added earlier may be in the document where a card is typed.
  const to = state.to;
  useEffect(() => {
    if (to) window.location.assign(to);
  }, [to]);
  const [who, setWho] = useState({ name: contact?.name ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "" });
  // Kept as typed: a form action resets its fields, and a mistyped number should not be lost.
  const [companyName, setCompanyName] = useState(company?.name ?? "");
  const [companyNumber, setCompanyNumber] = useState(company?.number ?? "");
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
        disabled={disabled || pending || Boolean(to)}
        className="min-h-12 button-primary px-4 font-medium disabled:opacity-40"
      >
        {pending || to ? labels.startingPayment : labels.checkout}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {state.problem && labels.problems[state.problem]}
      </p>
    </form>
  );
}
