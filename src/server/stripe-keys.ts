import "server-only";

import { PAYMENT_MODES, platformKey, type PaymentModeName } from "@/lib/stripe-account";

/**
 * Kaizena Flow's own Stripe keys, read from the environment without the Stripe SDK (bloat review step 0.6): a store page asks
 * which payment modes the platform has (`getStore()`), and loading the SDK for that put it in every store page.
 */

/** The platform's secret key for a mode (STRIPE_SECRET_KEY_TEST / _LIVE), if it has the mode's shape; null otherwise. */
export function platformSecretKey(mode: PaymentModeName): string | null {
  return platformKey("secret", mode, mode === "test" ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY_LIVE);
}

/** The platform's publishable key for a mode, for Stripe's embedded components. */
export function platformPublishableKey(mode: PaymentModeName): string | null {
  return platformKey(
    "publishable",
    mode,
    mode === "test" ? process.env.STRIPE_PUBLISHABLE_KEY_TEST : process.env.STRIPE_PUBLISHABLE_KEY_LIVE,
  );
}

/** The modes Kaizen can take payments in: both of the mode's keys are configured. */
export function platformModes(): PaymentModeName[] {
  return PAYMENT_MODES.filter((mode) => platformSecretKey(mode) && platformPublishableKey(mode));
}
