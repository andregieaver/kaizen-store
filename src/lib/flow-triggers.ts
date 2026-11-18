/** The events that may start a flow (D767, `docs/flows.md`): slice 1's three; slice 4 adds the rest (M2.3). No imports: the schema reads it. */
export const FLOW_TRIGGERS = ["subscriber.subscribed", "order.paid", "checkout.abandoned"] as const;
