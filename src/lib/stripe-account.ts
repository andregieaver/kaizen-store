/**
 * Kaizen runs payments on Stripe Connect (decision D17): each store is the
 * seller on its own connected Stripe account, created with the Accounts v2
 * API as Stripe advises for Shopify-like platforms. These helpers are pure,
 * so they can be tested without Stripe.
 */

export type PaymentModeName = "test" | "live";

export const PAYMENT_MODES: readonly PaymentModeName[] = ["test", "live"];

/**
 * A platform key from the environment, if it has the right shape for the
 * mode: `sk_`/`rk_` for secret keys (restricted keys are fine), `pk_` for
 * publishable keys. Anything else counts as not configured.
 */
export function platformKey(
  kind: "secret" | "publishable",
  mode: PaymentModeName,
  value: string | undefined,
): string | null {
  const key = value?.trim();
  if (!key || /\s/.test(key)) return null;
  const prefixes = kind === "secret" ? [`sk_${mode}_`, `rk_${mode}_`] : [`pk_${mode}_`];
  return prefixes.some((prefix) => key.startsWith(prefix)) ? key : null;
}

/** What Kaizen keeps of a connected account's state (stripe_accounts). */
export type AccountStatus = {
  /** Stripe's card_payments capability status, or "inactive" if not requested. */
  cardPayments: string;
  /** The store owner must give Stripe more information now. */
  requirementsDue: boolean;
};

type AccountLike = {
  configuration?: {
    merchant?: { capabilities?: { card_payments?: { status?: string } } } | null;
  } | null;
  requirements?: {
    entries?: { awaiting_action_from?: string; minimum_deadline?: { status?: string } }[];
  } | null;
};

/**
 * Reads the status from an Accounts v2 object retrieved with
 * `include: ["configuration.merchant", "requirements"]`. Stripe advises
 * checking the card_payments capability, not the old `charges_enabled`.
 */
export function accountStatus(account: AccountLike): AccountStatus {
  const cardPayments = account.configuration?.merchant?.capabilities?.card_payments?.status ?? "inactive";
  const requirementsDue = (account.requirements?.entries ?? []).some(
    (entry) =>
      entry.awaiting_action_from !== "stripe" &&
      (entry.minimum_deadline?.status === "currently_due" || entry.minimum_deadline?.status === "past_due"),
  );
  return { cardPayments, requirementsDue };
}

export type AccountStage = "not_started" | "needs_info" | "in_review" | "ready";

/** One word for the owner: what state their Stripe account is in. */
export function accountStage(account: AccountStatus | null): AccountStage {
  if (!account) return "not_started";
  if (account.requirementsDue) return "needs_info";
  return account.cardPayments === "active" ? "ready" : "in_review";
}

/**
 * Kaizen's fee on a sale, in minor units. Stripe needs it positive and below
 * the charge, so no fee is sent when it rounds to nothing.
 */
export function saleFee(totalMinor: number, feeBps: number): number | null {
  if (feeBps <= 0 || totalMinor <= 0) return null;
  const fee = Math.round((totalMinor * feeBps) / 10_000);
  return fee > 0 && fee < totalMinor ? fee : null;
}
