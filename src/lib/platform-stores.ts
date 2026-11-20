import { listPage } from "./list-page";

/**
 * What the platform's Stores list (code review step 2.10, D847) is asked for in its address: a search (`q`, the store's name or address,
 * an owner's name or email, or one of its domains), the store's own state (`state`: open, suspended or closed, the chips), its plan (`plan`:
 * a plan's id, or `none`) and its subscription (`billing`), and the page. Anything else in the address is the whole list: an unknown word,
 * a plan that is not an id. Pure, so the page, its pager and the tests read one parser.
 */

/** The store's own status (D171), as the chips name it. */
export const STORE_STATES = ["active", "suspended", "closed"] as const;
export type StoreState = (typeof STORE_STATES)[number];

/** The subscription as the list's rows say it: on a free trial, paying, overdue, ending at the period's end, or cancelled. */
export const STORE_BILLINGS = ["trialing", "paying", "overdue", "cancelling", "cancelled"] as const;
export type StoreBillingFilter = (typeof STORE_BILLINGS)[number];

export type StoreListFilter = {
  q: string;
  state: StoreState | null;
  /** A plan's id, or `none` for the stores with no plan. */
  plan: string | null;
  billing: StoreBillingFilter | null;
};

type Query = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest search read; more is cut, as the store admin's lists cut theirs. */
export const STORE_SEARCH_MAX = 100;

/**
 * The list's filter from its address. The state chips are the search form's buttons, sent after the state the form keeps, so the last
 * state named wins (`all` is every state), as the Products list's views do (D834).
 */
export function storeListFilter(query: Query): StoreListFilter & { page: number } {
  const q = ([query.q].flat()[0] ?? "").trim().slice(0, STORE_SEARCH_MAX);
  const state = [query.state].flat().reduce<StoreState | null>((was, value) => (value === "all" ? null : (STORE_STATES.find((s) => s === value) ?? was)), null);
  const asked = [query.plan].flat()[0]?.trim().toLowerCase() ?? "";
  const plan = asked === "none" || UUID.test(asked) ? asked : null;
  const billing = STORE_BILLINGS.find((b) => b === [query.billing].flat()[0]) ?? null;
  return { q, state, plan, billing, page: listPage(query.page) };
}

/** The filter as an address's query, its empty values left out: the pager's links and the way back keep it. */
export function storeListQuery({ q, state, plan, billing }: StoreListFilter): Record<string, string | undefined> {
  return { q: q || undefined, state: state ?? undefined, plan: plan ?? undefined, billing: billing ?? undefined };
}

/** Whether the list is narrowed at all: a search, a state, a plan or a subscription. */
export const storeListFiltered = ({ q, state, plan, billing }: StoreListFilter): boolean => Boolean(q || state || plan || billing);
