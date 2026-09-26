"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";

import type { PriceVat } from "@/lib/pricing";
import { planPrice } from "@/lib/subscriptions";

import { VatAmount, type VatLabels } from "./price";

/** A purchase option as the product page shows it, with its text in the shopper's language. */
export type PlanChoice = { id: string; discountPercent: number; label: string; note: string };

const Chosen = createContext<PlanChoice | null>(null);

/**
 * The product page's choice between buying once and subscribing (D25), as
 * Shopify's purchase options: one choice for the whole product, which the
 * prices and the add-to-cart buttons below follow.
 */
export function PurchaseOptions({
  plans,
  subscriptionOnly,
  labels,
  children,
}: {
  plans: PlanChoice[];
  subscriptionOnly: boolean;
  labels: { legend: string; oneTime: string };
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<PlanChoice | null>(subscriptionOnly ? plans[0] : null);
  const name = useId();
  if (plans.length === 0) return children;
  const option = (plan: PlanChoice | null, label: string, note: string) => (
    <label
      key={plan?.id ?? "once"}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 has-checked:border-foreground"
    >
      <input
        type="radio"
        name={name}
        checked={chosen?.id === plan?.id}
        onChange={() => setChosen(plan)}
        className="size-4 shrink-0"
      />
      <span className="flex flex-1 flex-wrap justify-between gap-x-3">
        <span className="font-medium">{label}</span>
        {note && <span className="text-sm text-muted">{note}</span>}
      </span>
    </label>
  );
  return (
    <Chosen.Provider value={chosen}>
      <fieldset className="mb-4 flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{labels.legend}</legend>
        {!subscriptionOnly && option(null, labels.oneTime, "")}
        {plans.map((plan) => option(plan, plan.label, plan.note))}
      </fieldset>
      {children}
    </Chosen.Provider>
  );
}

/** The purchase option chosen on the page, or null for buying once. */
export function useChosenPlan(): PlanChoice | null {
  return useContext(Chosen);
}

/**
 * A variant's price for the chosen purchase option: the server's price
 * (with its 30-day reference) when buying once, the subscriber's otherwise.
 */
export function PlanPrice({
  amountMinor,
  currency,
  locale,
  vat,
  labels,
  children,
}: {
  amountMinor: number;
  currency: string;
  locale: string;
  vat: PriceVat;
  labels: VatLabels;
  children: ReactNode;
}) {
  const plan = useChosenPlan();
  if (!plan) return children;
  return (
    <div>
      <p className="font-semibold">
        <VatAmount
          amountMinor={planPrice(amountMinor, plan.discountPercent)}
          currency={currency}
          locale={locale}
          vat={vat}
          labels={labels}
        />
      </p>
      <p className="text-sm text-muted">{plan.label}</p>
    </div>
  );
}
