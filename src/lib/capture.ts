/**
 * Authorise now, capture later (wave 4 unit B, D289, `docs/wave-4-payments.md` 4): when a store takes the money for an order. Pure, with no imports
 * (`src/db/schema.ts` reads the lists for its checks). The store's choice is `order_settings.capture`; an order checked out under a later capture keeps
 * its own `orders.capture_mode`, so changing the setting never changes an order already placed. English, as the admin.
 */

/** `order_settings.capture`. */
export const CAPTURE_SETTINGS = ["at_checkout", "when_sent", "by_hand"] as const;
export type CaptureSetting = (typeof CAPTURE_SETTINGS)[number];

/** `orders.capture_mode`: the later capture an order was checked out under (null: captured at checkout). */
export const CAPTURE_MODES = ["when_sent", "by_hand"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const isCaptureSetting = (value: unknown): value is CaptureSetting => (CAPTURE_SETTINGS as readonly unknown[]).includes(value);

export const CAPTURE_SETTING_WORDS: Record<CaptureSetting, { label: string; hint: string }> = {
  at_checkout: { label: "When the order is placed", hint: "The customer's card is charged at checkout. The usual choice." },
  when_sent: { label: "When the order is sent", hint: "The card is held at checkout and charged when you record the first parcel." },
  by_hand: { label: "When you capture it", hint: "The card is held at checkout and charged when you press Capture on the order." },
};

/** What an order is, as far as the capture rule asks. */
export type CaptureFacts = {
  subscription: boolean;
  /** Any line of an appointment, stay or rental (D65 to D70). */
  booking: boolean;
  /** A deposit or a balance at the venue (D66). */
  partial: boolean;
  /** A host's listing (D71). */
  host: boolean;
  /** Any download (delivered the moment the order is paid). */
  digital: boolean;
  /** Nothing to send: with `when_sent` the card would never be charged. */
  ships: boolean;
};

export type CaptureRefusal = "subscription" | "booking" | "partial" | "host" | "digital" | "nothing_to_send";

/**
 * The capture an order is checked out under: null when the store captures at checkout, or the order is of a kind that always captures at once
 * (subscriptions, bookings, deposits and venue balances, hosts' listings, downloads; and, for `when_sent`, an order with nothing to send). Drafts, pay
 * links, order changes, exchanges and weekly boxes never ask (their sessions are not checkouts).
 */
export function captureModeFor(setting: CaptureSetting, f: CaptureFacts): { mode: CaptureMode | null; refused: CaptureRefusal | null } {
  if (setting === "at_checkout") return { mode: null, refused: null };
  const refused: CaptureRefusal | null = f.subscription
    ? "subscription"
    : f.booking
      ? "booking"
      : f.partial
        ? "partial"
        : f.host
          ? "host"
          : f.digital
            ? "digital"
            : setting === "when_sent" && !f.ships
              ? "nothing_to_send"
              : null;
  return refused ? { mode: null, refused } : { mode: setting, refused: null };
}

/** How long an authorisation is kept when Stripe gives no date (cards: 7 days; Stripe's own `capture_before` wins when given). */
export const DEFAULT_HOLD_DAYS = 7;
/** Staff are told this long before an authorisation lapses. */
export const CAPTURE_WARNING_HOURS = 24;

/** When an authorisation lapses: Stripe's `capture_before` when it gave one, else seven days from the authorisation. */
export function captureDeadline(authorisedAt: Date, stripeCaptureBefore: number | null | undefined): Date {
  if (typeof stripeCaptureBefore === "number" && stripeCaptureBefore > 0) return new Date(stripeCaptureBefore * 1000);
  return new Date(authorisedAt.getTime() + DEFAULT_HOLD_DAYS * 86_400_000);
}

export type CaptureProblem = "not_authorized" | "amount" | "expired" | "stripe" | "copied";

/** Whether `amountMinor` may be captured of an authorisation of `authorisedMinor`: a whole minor unit, more than 0 and at most what was held. */
export function captureAmountProblem(amountMinor: number, authorisedMinor: number): "amount" | null {
  return Number.isInteger(amountMinor) && amountMinor > 0 && amountMinor <= authorisedMinor ? null : "amount";
}

export const CAPTURE_PROBLEM_WORDS: Record<CaptureProblem, string> = {
  not_authorized: "This order has no payment waiting to be captured.",
  amount: "Capture an amount above zero and at most what the card holds.",
  expired: "The hold on the card has ended. The order was cancelled and its stock released.",
  stripe: "Stripe could not capture the payment. Nothing was charged; try again, or cancel the order.",
  copied: "A copied order is history: it is never charged.",
};

/** An order's history lines for a held card and its capture (`order.authorized`, `payment.captured`); null for any other event. */
export function captureEventText(type: string, data: Record<string, unknown>, money: (minor: number) => string): string | null {
  if (type === "order.authorized") return data.mode === "when_sent" ? "Card held: charged when the order is sent" : "Card held: charged when you capture it";
  if (type === "payment.captured") {
    const amount = Number(data.amount);
    const released = Number(data.released);
    const captured = Number.isFinite(amount) && amount > 0 ? `Captured ${money(amount)}` : "Captured";
    const rest = Number.isFinite(released) && released > 0 ? `; ${money(released)} of the hold released` : "";
    return `${captured}${rest}${data.by ? "" : " (by Kaizena Flow)"}`;
  }
  return null;
}
