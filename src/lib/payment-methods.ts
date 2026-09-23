/**
 * Payment methods the store can offer through Stripe, and where. The store
 * owner switches each on or off per market in the admin (decision D15); a
 * method only appears for markets where Stripe supports it.
 */
export type PaymentMethodInfo = {
  /** Stripe's payment method type. */
  id: string;
  name: string;
  /** Market codes where Stripe can offer it to shoppers. */
  markets: readonly string[];
  note?: string;
};

export const PAYMENT_METHODS: readonly PaymentMethodInfo[] = [
  {
    id: "card",
    name: "Cards",
    markets: ["NO", "SE", "DK"],
    note: "Includes Apple Pay and Google Pay once they are enabled in the Stripe Dashboard.",
  },
  { id: "link", name: "Link", markets: ["NO", "SE", "DK"] },
  { id: "klarna", name: "Klarna", markets: ["NO", "SE", "DK"] },
  { id: "mobilepay", name: "MobilePay", markets: ["DK"] },
  { id: "swish", name: "Swish", markets: ["SE"] },
  { id: "paypal", name: "PayPal", markets: ["NO", "SE", "DK"] },
];

export function methodsForMarket(marketCode: string): PaymentMethodInfo[] {
  return PAYMENT_METHODS.filter((method) => method.markets.includes(marketCode));
}

export function isKnownMethod(marketCode: string, methodId: string): boolean {
  return methodsForMarket(marketCode).some((method) => method.id === methodId);
}

export type PaymentModeName = "test" | "live";

export type StripeCredentialInput = {
  publishableKey?: string;
  secretKey?: string;
  webhookSecret?: string;
};

/**
 * Checks Stripe keys have the right shape for the mode, so test keys cannot
 * be saved as live ones or the other way round. Empty fields are left as they
 * were. Returns a list of problems; empty means valid.
 */
export function validateStripeCredentials(
  mode: PaymentModeName,
  input: StripeCredentialInput,
): string[] {
  const problems: string[] = [];
  if (input.publishableKey && !input.publishableKey.startsWith(`pk_${mode}_`)) {
    problems.push(`The publishable key must start with pk_${mode}_.`);
  }
  if (
    input.secretKey &&
    !input.secretKey.startsWith(`sk_${mode}_`) &&
    !input.secretKey.startsWith(`rk_${mode}_`)
  ) {
    problems.push(`The secret key must start with sk_${mode}_ (or rk_${mode}_ for a restricted key).`);
  }
  if (input.webhookSecret && !input.webhookSecret.startsWith("whsec_")) {
    problems.push("The webhook signing secret must start with whsec_.");
  }
  for (const value of Object.values(input)) {
    if (value && /\s/.test(value)) {
      problems.push("Keys cannot contain spaces or line breaks.");
      break;
    }
  }
  return problems;
}
