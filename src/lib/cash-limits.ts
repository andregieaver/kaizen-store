/**
 * Cash taken for a draft order (wave 3, D173, review fix). Some countries forbid a business to receive cash above a ceiling (Norway: hvitvaskingsloven § 5, 40,000 NOK for goods), so recording a larger
 * cash payment would legitimise a payment its owner may not lawfully accept. The ceilings are DATA here, per country, in the country's own currency, with where each came from and whether a person has
 * checked it: `refuse` stops the recording, `warn` shows the owner a notice and goes on. A country without a row has no rule Kaizen knows of: that is not a statement that there is none (docs/wave-3-orders.md
 * section 8). Needs human legal review before it is relied on; the amounts are not advice.
 */
export type CashRule = {
  /** The ceiling in minor units of `currency`: a cash payment of this much or more is caught. */
  limitMinor: number;
  currency: string;
  mode: "refuse" | "warn";
  /** Where the rule was read, for the person who reviews it. */
  source: string;
  /** True only when a person has read the source and the amount. */
  verified: boolean;
};

// legal: needs review
export const CASH_RULES: Record<string, CashRule> = {
  NO: {
    limitMinor: 4_000_000,
    currency: "NOK",
    mode: "refuse",
    source: "Hvitvaskingsloven § 5 (https://lovdata.no/lov/2018-06-01-23/%C2%A75); Skatteetaten's guidance on the cash ban",
    verified: false,
  },
  DK: {
    limitMinor: 1_500_000,
    currency: "DKK",
    mode: "warn",
    source: "Reported as 15,000 to 20,000 DKK; not read in an official source",
    verified: false,
  },
};

/** The rule for a country (its code, any case), or null. */
export function cashRuleOf(country: string): CashRule | null {
  return CASH_RULES[country.trim().toUpperCase()] ?? null;
}

export type CashCheck = { kind: "ok" } | { kind: "refuse"; rule: CashRule } | { kind: "warn"; rule: CashRule };

/**
 * Whether a cash payment of `amountMinor` (in `currency`) is caught by the country's rule. `limitInCurrency` is the rule's ceiling in the payment's currency when that is not the rule's own (the caller converts it at
 * the store's rates); null when it could not be converted, which a `refuse` rule treats as caught (nothing is let through on a guess).
 */
export function checkCash(country: string, amountMinor: number, currency: string, limitInCurrency?: number | null): CashCheck {
  const rule = cashRuleOf(country);
  if (!rule) return { kind: "ok" };
  const limit = currency === rule.currency ? rule.limitMinor : (limitInCurrency ?? null);
  const caught = limit === null ? true : amountMinor >= limit;
  if (!caught) return { kind: "ok" };
  return { kind: rule.mode, rule };
}

/** The words of the warning beside the Cash method, listing every rule held (English admin text, flagged for review). */
export function cashRuleWords(): string {
  return Object.entries(CASH_RULES)
    .map(([country, rule]) => {
      const amount = new Intl.NumberFormat("en", { style: "currency", currency: rule.currency, maximumFractionDigits: 0 }).format(rule.limitMinor / 100);
      return `${country}: ${rule.mode === "refuse" ? "Kaizen does not record" : "take care with"} cash of ${amount} or more${rule.verified ? "" : " (not yet checked by a person)"}.`;
    })
    .join(" ");
}
