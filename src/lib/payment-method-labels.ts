/**
 * A payment method's state in English (D288, bloat review step 2.50): beside `payment-methods.ts`, whose `METHOD_STATE_WORDS` the AI manager
 * and the tests read, so the `payments` catalogue takes its `methods.states` from here and `payment-methods.ts`, which a client card imports,
 * brings no catalogue. Imports nothing.
 */

export const METHOD_STATES = {
  active: "Active",
  pending: "Stripe is checking",
  requested: "Requested",
  unavailable: "Not available",
  not_read: "Not read yet",
};
