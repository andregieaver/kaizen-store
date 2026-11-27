"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";

import type { PriceDecimals } from "@/lib/money";
import type { PriceWords } from "@/lib/price-words";
import type { PriceVat } from "@/lib/pricing";
import { planPrice, plansFor } from "@/lib/subscriptions";
import type { ShownMeasure } from "@/lib/unit-price";
import type { UnitLabels } from "@/lib/unit-price-text";

import { UnitLine, VatAmount, type VatLabels } from "./price";
import { useVariantChoice } from "./variant-chosen";

/** A purchase option as the product page shows it, with its text in the shopper's language; `variantId` when it is for one variant (D911). */
export type PlanChoice = { id: string; variantId: string | null; discountPercent: number; label: string; note: string };

const Chosen = createContext<PlanChoice | null>(null);

/**
 * The product page's choice between buying once and subscribing (D25), as
 * Shopify's purchase options: one choice, which the prices and the
 * add-to-cart buttons below follow. It offers only the options the chosen
 * variant can be bought with (D911): monthly and yearly as variants with their
 * own prices each have their own option, so the two are never mixed. Inside
 * the page's `VariantChoice`.
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
  const [variantId] = useVariantChoice("");
  const offered = plansFor(plans, variantId);
  const [picked, setPicked] = useState<string | null>(subscriptionOnly ? (offered[0]?.id ?? null) : null);
  // Another variant chosen keeps the option picked where it applies; otherwise its first option, or buying once.
  const chosen = offered.find((plan) => plan.id === picked) ?? (subscriptionOnly ? (offered[0] ?? null) : null);
  const setChosen = (plan: PlanChoice | null) => setPicked(plan?.id ?? null);
  const name = useId();
  if (offered.length === 0) return children;
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
        {offered.map((plan) => option(plan, plan.label, plan.note))}
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
 * (with its 30-day reference and unit price) when buying once, the subscriber's
 * otherwise, with the unit price (D160) worked out again from that reduced
 * price by the same pure function, here in the browser.
 */
export function PlanPrice({
  amountMinor,
  currency,
  locale,
  vat,
  labels,
  measure = null,
  unitLabels,
  decimals,
  words,
  children,
}: {
  amountMinor: number;
  currency: string;
  locale: string;
  vat: PriceVat;
  labels: VatLabels;
  measure?: ShownMeasure | null;
  unitLabels?: UnitLabels;
  /** The market's way with a whole amount's decimals and the owner's words around the price (D429), as the price bought once has them. */
  decimals?: PriceDecimals;
  words?: PriceWords;
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
          decimals={decimals}
          words={words}
        />
      </p>
      <p className="text-sm text-muted">{plan.label}</p>
      {unitLabels && (
        <UnitLine
          amountMinor={planPrice(amountMinor, plan.discountPercent)}
          currency={currency}
          locale={locale}
          vat={vat}
          measure={measure}
          labels={unitLabels}
          decimals={decimals}
        />
      )}
    </div>
  );
}

/** A variant's amount alone for the chosen purchase option, for lists where the full price does not fit (no words around it, D429). */
export function PlanAmount({
  amountMinor,
  currency,
  locale,
  vat,
  labels,
  decimals,
}: {
  amountMinor: number;
  currency: string;
  locale: string;
  vat: PriceVat;
  labels: VatLabels;
  decimals?: PriceDecimals;
}) {
  const plan = useChosenPlan();
  return (
    <VatAmount
      amountMinor={plan ? planPrice(amountMinor, plan.discountPercent) : amountMinor}
      currency={currency}
      locale={locale}
      vat={vat}
      labels={labels}
      label={false}
      decimals={decimals}
    />
  );
}
