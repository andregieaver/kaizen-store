/** The events of the log that may start a flow (D767, `docs/flows.md`): slice 1's three; slice 4 adds the rest (M2.3). No imports: the schema reads it. */
export const EVENT_TRIGGERS = ["subscriber.subscribed", "order.paid", "checkout.abandoned"] as const;

/**
 * The triggers checked on a clock rather than read from the event log (slice 4): `customer.lapsed`, a person on the list whose latest
 * paid order is the flow's days old with nothing ordered since, entered once per such order (win-back, M2.3).
 */
export const DATE_TRIGGERS = ["customer.lapsed"] as const;

/** Every trigger a flow may have. */
export const FLOW_TRIGGERS = [...EVENT_TRIGGERS, ...DATE_TRIGGERS] as const;

/** The days a lapse trigger may wait, as the win-back automation's (D298). */
export const LAPSE_DAYS = { min: 30, max: 730 } as const;
