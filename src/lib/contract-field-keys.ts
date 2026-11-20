/**
 * The fields a contract's words may name (D695), without the schema (`contract-fields.ts` re-exports them): a page's browser scripts that
 * only list them do not carry zod.
 */

/** The fields a template may name, as `{key}` in its words. Their values come from the deal, its person and company, the store and today. */
export const CONTRACT_FIELDS = [
  "customer.name",
  "customer.email",
  "customer.phone",
  "customer.address",
  "company.name",
  "company.org_number",
  "company.address",
  "store.name",
  "store.org_number",
  "store.address",
  "store.email",
  "deal.title",
  "deal.owner",
  "deal.value",
  "contract.title",
  "contract.date",
  "contract.expires",
] as const;
export type ContractField = (typeof CONTRACT_FIELDS)[number];
