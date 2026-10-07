import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every reader of `payments.provider` (wave 3, run 2, D173, `docs/wave-3-orders.md` 3.1 and 6.5(d), review fix). Money taken outside Kaizen is a payment with provider `manual`: a reader that
 * names `'stripe'` or `'venue'` and was written before it silently leaves such an order out (the order page's key, the withdrawal link, the terms record). This test reads the source and fails for a
 * reader that is not in the list below, with the reason it is right to name the providers it names, and for any reader of the order page's key that leaves `'manual'` out.
 *
 * To add a reader: decide which providers it must see, and add the file (or its new count) here with the reason. A count that changed is a reader that was added or removed.
 */
const READERS: Record<string, { count: number; reason: string }> = {
  "src/server/invoice-settings.ts": { count: 1, reason: "reads `payment_providers` (the store's Stripe settings), not payments" },
  "src/server/settings.ts": { count: 6, reason: "reads `payment_providers` (the store's Stripe switches and keys), not payments" },
  "src/server/control-center.ts": { count: 1, reason: "reads `payment_providers` (is Stripe on), not payments" },
  "src/server/connect.ts": { count: 2, reason: "reads `platform_webhooks`, Kaizen's own endpoints at Stripe" },
  "src/server/referral-billing.ts": { count: 1, reason: "reads `platform_webhooks`" },
  "src/server/stripe-refunds.ts": { count: 1, reason: "a refund Stripe reports belongs to the Stripe payment it names; a manual refund is never reported by Stripe" },
  "src/server/stripe-webhooks.ts": { count: 3, reason: "Stripe's events and sessions find the Stripe payment by its provider reference" },
  "src/server/subscriptions.ts": { count: 3, reason: "a subscription's payments and Kaizen's webhook endpoint are Stripe's; a draft order is never a subscription" },
  "src/server/standing-orders.ts": { count: 2, reason: "a weekly delivery's saved card and pay link are Stripe's; a draft order is never a delivery" },
  "src/server/no-show.ts": { count: 1, reason: "a no-show fee is charged to the card Stripe saved with a deposit; a booking is never a draft order" },
  "src/server/dac7.ts": { count: 2, reason: "a host's orders are paid through Stripe on the host's account (D71); a draft order has no host" },
  "src/server/host-payments.ts": { count: 3, reason: "a host's payments and commissions are Stripe's (D71); a draft order has no host" },
  "src/server/checkout.ts": { count: 2, reason: "closes the Stripe sessions of an order waiting for payment; a manual payment has no session" },
  "src/server/store-closure.ts": { count: 1, reason: "counts pending Stripe sessions that closing a store must wait for" },
  "src/server/privacy-erasure.ts": { count: 1, reason: "closes pending Stripe sessions before an unpaid order is cancelled" },
  "src/server/draft-pay.ts": { count: 3, reason: "the draft's pay link opens, counts and closes Stripe sessions" },
  "src/server/draft-sessions.ts": { count: 1, reason: "closes the pending Stripe sessions of a draft's order" },
  "src/server/draft-orders.ts": { count: 2, reason: "counts a draft order's pending Stripe sessions in the transaction that records money paid outside (and a comment naming the manual provider)" },
  "src/server/order-admin.ts": {
    count: 7,
    reason:
      "the refund code: refundable is Stripe's and manual's captured money; a refund is split over the order's captured Stripe payments on a connected account and manual ones (recorded, no Stripe call), each within what it has left (D174 review); the venue's pending balance is marked paid there",
  },
  "src/server/order-edits.ts": {
    count: 7,
    reason:
      "an order change (D174): whether the order was paid through Stripe (a lower total is refunded there) or only outside Kaizen (refunded by being recorded), its test mode, what is left to refund (Stripe's and manual's captured money), the manual payment that records a change paid outside Kaizen, and the order's cash recorded outside Kaizen for the country's cash ceiling (review fix)",
  },
  "src/server/order-edit-emails.ts": { count: 1, reason: "the change email says the store pays a refund back itself when the refunded payment was taken outside Kaizen (manual)" },
  "src/server/order-export.ts": { count: 1, reason: "flags a venue payment made in Stripe's test mode in the order file; a manual payment is never a test payment (`payments_manual_real`)" },
  "src/server/orders.ts": { count: 3, reason: "the order page's key reads stripe, venue and manual payments; the other two read `payment_providers`" },
  "src/server/booking-changes.ts": { count: 1, reason: "the order page's key: stripe, venue and manual" },
  "src/server/withdrawals.ts": { count: 3, reason: "the order page's key as the withdrawal function's proof: stripe, venue and manual" },
  "src/server/withdraw-link.ts": { count: 1, reason: "the order page's key in the confirmation email's withdrawal link: stripe, venue and manual" },
  "src/server/shopper-emails.ts": { count: 1, reason: "the order page's key in the confirmation email's order link: stripe, venue and manual" },
  "src/server/checkout-terms.ts": { count: 1, reason: "the order page's key for the terms the order was placed under: stripe, venue and manual" },
  "src/db/schema.ts": { count: 1, reason: "a comment on the column naming the manual provider" },
};

/** A condition on a payment's provider that names one of the three providers a payment can have. */
const READER = /provider\s*(?:=\s*|in\s*\([^)]*)'(?:stripe|venue|manual)'/g;
/** The order page's key: a list of providers with both stripe and venue in it. It must hold manual too. */
const KEY_LIST = /provider\s*in\s*\(([^)]*)\)/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const root = path.resolve(__dirname, "../..");
const files = sources(path.join(root, "src"));

describe("every reader of payments.provider is known and says why (D173 review)", () => {
  it("is the list above: a new reader, or a removed one, is a decision to make", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const count = (readFileSync(file, "utf8").match(READER) ?? []).length;
      if (count > 0) found[path.relative(root, file)] = count;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(READERS).map(([file, { count }]) => [file, count])));
  });

  it("gives every entry a reason", () => {
    for (const [file, entry] of Object.entries(READERS)) expect(entry.reason.length, file).toBeGreaterThan(20);
  });

  it("leaves 'manual' out of no list that holds both 'stripe' and 'venue': the order page's key must see a payment taken outside Kaizen", () => {
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(KEY_LIST)) {
        const list = match[1];
        if (list.includes("'stripe'") && list.includes("'venue'") && !list.includes("'manual'")) missing.push(`${path.relative(root, file)}: ${match[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
