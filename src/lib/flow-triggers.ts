/**
 * The events of the log that may start a flow (D767, `docs/flows.md`), each naming a person on the list through its subject
 * (`emailOfSubject()`): slice 1's three, and slice 4's (M2.3): orders sent, subscriptions, forms, quotes and reviews, then (24 November
 * 2026) refunds, returns asked for, support conversations ended or rated, deals made or won and contracts signed. A new one needs its
 * person in `emailOfSubject()`, its words (the story's sentence) and its line in `flow-audience.ts`. No imports: the schema reads it.
 */
export const EVENT_TRIGGERS = [
  "subscriber.subscribed",
  "order.paid",
  "checkout.abandoned",
  "order.sent",
  "subscription.started",
  "subscription.cancelled",
  "form.response",
  "quote.requested",
  "review.created",
  "order.refunded",
  "return.requested",
  "conversation.ended",
  "conversation.rated",
  "deal.created",
  "deal.won",
  "contract.signed",
] as const;

/**
 * The triggers checked on a clock rather than read from the event log (slice 4): `customer.lapsed`, a person on the list whose latest
 * paid order is the flow's days old with nothing ordered since, entered once per such order (win-back, M2.3); `customer.browsed`, a
 * signed-in subscriber whose latest product view (D691) is the flow's days old with nothing paid since, once per day of viewing;
 * `subscriber.asleep`, a person on the list with no press on a link in the flow's days and on it at least that long (the sunset, M2.8),
 * once per time they fall asleep.
 */
export const DATE_TRIGGERS = ["customer.lapsed", "customer.browsed", "subscriber.asleep"] as const;
export type DateTrigger = (typeof DATE_TRIGGERS)[number];

/**
 * The triggers checked on a clock that take no days (M2.3): `customer.birthday`, a person on the list whose customer gave a birthday
 * (D401, `MM-DD`), on that day in the store's time zone, once a year, the date given at least 30 days before (as the birthday credit).
 */
export const DAY_TRIGGERS = ["customer.birthday"] as const;

/**
 * The trigger read from a saved segment (M2.3): `segment.entered`, a person on the list who comes into the flow's segment (`trigger_segment_id`),
 * found by an hourly read of the segment (`enterSegments()`); those in it when the flow is switched on are only noted, never emailed.
 */
export const SEGMENT_TRIGGERS = ["segment.entered"] as const;

/** Every trigger a flow may have. */
export const FLOW_TRIGGERS = [...EVENT_TRIGGERS, ...DATE_TRIGGERS, ...DAY_TRIGGERS, ...SEGMENT_TRIGGERS] as const;

/** The days a lapse trigger may wait, as the win-back automation's (D298). */
export const LAPSE_DAYS = { min: 30, max: 730 } as const;

/** Each date trigger's days, as its automation's (D298, D691: views are kept 7 days, so a browse flow waits at most 5); and where it starts. */
export const DATE_TRIGGER_DAYS: Record<DateTrigger, { min: number; max: number; start: number }> = {
  "customer.lapsed": { ...LAPSE_DAYS, start: 90 },
  "customer.browsed": { min: 1, max: 5, start: 1 },
  // Presses are kept 180 days (CLICK_DAYS), so a sunset waits at most that long.
  "subscriber.asleep": { min: 90, max: 180, start: 180 },
};

export const isDateTrigger = (trigger: string): trigger is DateTrigger => (DATE_TRIGGERS as readonly string[]).includes(trigger);
