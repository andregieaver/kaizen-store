import { normaliseTag, type Tag } from "./order-tags";

/**
 * Kaizena Flow's own customers (D467, `docs/platform-parity-plan.md` step 2): the owners of its customers' stores and the people who asked for
 * one are customers of Kaizena Flow's own store (D466), so its segments, broadcasts, automations, deals and privacy requests serve Kaizena
 * Flow as any store's serve it. This file is the pure part: the tags the platform keeps on each person, and where a sign-up's deal stands.
 * `src/server/house-customers.ts` reads the facts and writes them.
 */

/** The tags the platform keeps on Kaizena Flow's own customers, as segments read them (D296): staff's own tags are never touched. */
export const HOUSE_TAG = {
  owner: "Owner",
  lead: "Lead",
  trial: "Trial",
  overdue: "Overdue",
  noPlan: "No plan",
  storeOpen: "Store open",
} as const;

/** A plan's tag: `Plan: Growth`. */
export const PLAN_TAG_PREFIX = "Plan: ";

const MANAGED = new Set<string>(
  Object.values(HOUSE_TAG).map((label) => label.toLowerCase()),
);

/** Whether a tag's key is one the platform keeps (and so takes away when it no longer holds). */
export const isHouseTagKey = (key: string): boolean =>
  MANAGED.has(key) || key.startsWith(PLAN_TAG_PREFIX.toLowerCase());

/** What the platform knows of a person, from their account, their stores and their request. */
export type PersonFacts = {
  /** Owns at least one store that is a customer's (not closed). */
  owner: boolean;
  /** Has an application to open a store waiting for an answer. */
  waiting: boolean;
  /** The names of the plans their stores run on (trialing, active or past due). */
  plans: readonly string[];
  /** A store of theirs is on a free trial. */
  trial: boolean;
  /** A store's plan is past due or unpaid. */
  overdue: boolean;
  /** A store of theirs has been opened. */
  storeOpen: boolean;
};

/** The tags a person should carry, in a fixed order; a plan whose name cannot be a tag is left out. */
export function houseTags(facts: PersonFacts): Tag[] {
  const labels: string[] = [];
  if (facts.owner) labels.push(HOUSE_TAG.owner);
  if (facts.waiting && !facts.owner) labels.push(HOUSE_TAG.lead);
  if (facts.owner) {
    for (const plan of [...new Set(facts.plans)].sort())
      labels.push(`${PLAN_TAG_PREFIX}${plan}`);
    if (facts.plans.length === 0) labels.push(HOUSE_TAG.noPlan);
    if (facts.trial) labels.push(HOUSE_TAG.trial);
    if (facts.overdue) labels.push(HOUSE_TAG.overdue);
    if (facts.storeOpen) labels.push(HOUSE_TAG.storeOpen);
  }
  const out: Tag[] = [];
  for (const label of labels) {
    const result = normaliseTag(label);
    if (result.ok && !out.some((t) => t.key === result.tag.key))
      out.push(result.tag);
  }
  return out;
}

/** The Sign-ups pipeline Kaizena Flow's own store keeps its applications on: its name and stages, in the order an application goes. */
export const SIGNUP_PIPELINE = {
  name: "Sign-ups",
  stages: ["Asked", "Approved", "Store opened"],
} as const;

export type SignupStage = 0 | 1 | 2;

/** An application, as the platform knows it. */
export type RequestFacts = {
  status: "pending" | "approved" | "declined";
  /** The store it made has been opened. */
  storeOpened: boolean;
  /** The store it made has a plan that was paid (active). */
  planPaid: boolean;
};

/** Where an application's deal stands: its stage, and whether it is still open, won (a plan paid) or lost (declined). */
export function signupDeal(facts: RequestFacts): {
  stage: SignupStage;
  outcome: "open" | "won" | "lost";
} {
  if (facts.status === "declined") return { stage: 0, outcome: "lost" };
  if (facts.status === "pending") return { stage: 0, outcome: "open" };
  if (facts.planPaid)
    return { stage: facts.storeOpened ? 2 : 1, outcome: "won" };
  return { stage: facts.storeOpened ? 2 : 1, outcome: "open" };
}

/** A deal's title from the application: the store's name it asked for, or the person's address when it named none. */
export function signupTitle(storeName: string | null, email: string): string {
  const name = (storeName ?? "").replace(/\s+/g, " ").trim();
  return (name || email).slice(0, 200);
}
