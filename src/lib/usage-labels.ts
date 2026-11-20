/**
 * What a store is told when a hard limit of its plan is reached, in English (D314, bloat review step 2.50): beside `usage-format.ts`, so the
 * server's refusals (`limitRefusal()` with no language, on shoppers' routes too) and the admin's `capacity` catalogue read one text without
 * both languages of the catalogue. `{limit}` is filled in. Imports nothing.
 */
export const LIMIT_REFUSALS = {
  storage_bytes: "This store has used its {limit} of storage. Delete files you no longer need, or choose a plan with more.",
  products: "This store has its {limit} products. Archive one you no longer sell, or choose a plan with more.",
  staff_seats: "This store has its {limit} staff places. Remove someone, or choose a plan with more.",
  custom_domains: "This store has its {limit} domains. Remove one, or choose a plan with more.",
  marketing_emails_month: "This would pass the {limit} marketing emails this store may send this month. Send to fewer people, wait for next month, or choose a plan with more.",
  ai_cost_month_micros: "This store has used the AI its plan includes this month.",
  requests_month: "",
  egress_bytes_month: "",
  contracts_sent_month: "",
  recordings_month: "This store has recorded the {limit} visits its plan includes this month. Recording starts again next month, or choose a plan with more.",
  ab_tests_running: "Your plan runs up to {limit} A/B tests at a time. Stop one first, or choose a plan with more.",
  stores_owned: "Your plan allows {limit} stores. Choose a plan with more to add another.",
};

/** What each measured figure is called, in English: read by the usage email, the AI manager's usage tools and the `capacity` catalogue. */
export const USAGE_METRICS = {
  storage_bytes: "Storage",
  products: "Products",
  staff_seats: "Staff",
  custom_domains: "Domains",
  requests: "Visits",
  egress_bytes: "Bandwidth",
  server_errors: "Server errors",
  emails: "Emails",
  marketing_emails: "Marketing emails",
  ai_cost_micros: "AI",
  recordings: "Recordings of visits",
  contracts_sent: "Contracts sent",
};
