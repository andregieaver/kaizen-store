/**
 * A/B tests of pages (D148, docs/ab-testing.md): the vocabulary, limits, cookies and the rules a test is checked with.
 * Pure and shared by the browser, the proxy, the server and the tests; the database holds the same rules (migration
 * `ab_experiments`).
 */

import { AB_TESTS_MOST } from "./limits";

export const EXPERIMENT_STATUSES = ["draft", "scheduled", "running", "stopped", "applied", "discarded"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/** Where a test can go from where it is (the database refuses anything else). */
export const NEXT_STATUSES: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  draft: ["scheduled", "running", "discarded"],
  scheduled: ["draft", "running", "discarded"],
  running: ["stopped"],
  stopped: ["applied", "discarded"],
  applied: [],
  discarded: [],
};

export const STATUS_WORDS: Record<ExperimentStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  running: "Running",
  stopped: "Stopped",
  applied: "Winner applied",
  discarded: "Discarded",
};

/** The signal of a status's chip in the admin's lists (docs/admin-style.md 5.7). */
export const STATUS_SIGNAL = {
  draft: "neutral",
  scheduled: "insight",
  running: "positive",
  stopped: "warning",
  applied: "positive",
  discarded: "neutral",
} as const satisfies Record<ExperimentStatus, "positive" | "warning" | "danger" | "neutral" | "insight">;

/** The engine's most, whatever the plan; a plan's `ab_tests_running` (phase 21) can only lower it. */
export const MAX_RUNNING_PER_STORE = AB_TESTS_MOST;
export const MAX_VARIANTS = 4;
export const MAX_RUN_DAYS = 90;
/** A test past its planned end keeps counting this long, then stops itself. */
export const AFTER_PLANNED_END_DAYS = 7;
/** The shortest a test runs before a verdict is given: whole weeks, so each weekday counts the same. */
export const MIN_DAYS = 14;
export { VARIANT_KEYS, type VariantKey } from "./ab-cookie";

export const GOALS = ["orders", "revenue", "cart", "checkout", "click", "form", "signup", "page"] as const;
export type Goal = (typeof GOALS)[number];

/**
 * The goals the AI manager's tools offer: every goal but `signup`, which only Kaizena Flow's own store has (D148 phase 19), and `page` (phase
 * 20), chosen on the new-test form. Kept apart so the tools' schema, and with it the agents' eval recording, changes only with a new eval run.
 */
export const TOOL_GOALS = ["orders", "revenue", "cart", "checkout", "click", "form"] as const satisfies readonly Goal[];

/** The goals only Kaizena Flow's own store can test: a sign-up to Kaizena Flow happens on its sign-up page, not in a store. */
export const HOUSE_GOALS = ["signup"] as const satisfies readonly Goal[];
export const isHouseGoal = (goal: Goal): boolean => (HOUSE_GOALS as readonly Goal[]).includes(goal);

/** What each goal measures, in the words the admin uses. */
export const GOAL_WORDS: Record<Goal, { label: string; asks: string; per: string; kind: "rate" | "money"; needsBlock: boolean; block?: "button" | "form"; needsPage?: boolean }> = {
  orders: { label: "More orders", asks: "get more of the visitors to buy", per: "placed an order", kind: "rate", needsBlock: false },
  revenue: { label: "More revenue per visitor", asks: "sell more per visitor", per: "revenue per visitor", kind: "money", needsBlock: false },
  cart: { label: "More people adding to the cart", asks: "get more visitors to add something to the cart", per: "added to the cart", kind: "rate", needsBlock: false },
  checkout: { label: "More people reaching checkout", asks: "get more visitors to start checkout", per: "started checkout", kind: "rate", needsBlock: false },
  click: { label: "More clicks on a button or link", asks: "get more visitors to click a chosen button or link", per: "clicked it", kind: "rate", needsBlock: true, block: "button" },
  // D93's email form or newsletter sign-up, counted when the site accepts the answer (D148, phase 11).
  form: { label: "More people sending a form", asks: "get more visitors to send a chosen form or sign up to a newsletter", per: "sent the form", kind: "rate", needsBlock: true, block: "form" },
  // A sign-up to Kaizena Flow sent from its sign-up page by a visitor in the test (D148 phase 19): only Kaizena Flow's own store.
  signup: { label: "More sign-ups to Kaizena Flow", asks: "get more visitors to sign up to Kaizena Flow", per: "signed up", kind: "rate", needsBlock: false },
  // A visitor in the test who then opened a chosen page of the store (D148 phase 20): its id in `goal_params.page`.
  page: { label: "More people going on to a page", asks: "get more visitors to go on to a chosen page", per: "opened the page", kind: "rate", needsBlock: false, needsPage: true },
};

/** What an owner chooses for a goal that counts something on the page, in words: "the button or link whose clicks you want more of". */
export const BLOCK_CHOICE: Record<"button" | "form", { problem: string; gone: string }> = {
  button: { problem: "Choose the button or link whose clicks you want more of.", gone: "That button is not on the page." },
  form: { problem: "Choose the form whose answers you want more of.", gone: "That form is not on the page." },
};

export const isGoal = (value: unknown): value is Goal => (GOALS as readonly unknown[]).includes(value);

/** Who is enrolled, beyond having accepted statistics: empty lists mean everyone. */
export type Audience = { markets?: string[]; devices?: Device[]; returning?: "new" | "returning" };
export const DEVICES = ["mobile", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

export type VisitContext = { market: string; device: Device; returning: boolean };

export function audienceAllows(audience: Audience | null | undefined, visit: VisitContext): boolean {
  if (!audience) return true;
  // Markets are chosen by country: the same visitor in `no` and `no-en` is in the same market.
  if (audience.markets && audience.markets.length > 0 && !audience.markets.includes(visit.market.split("-")[0])) return false;
  if (audience.devices && audience.devices.length > 0 && !audience.devices.includes(visit.device)) return false;
  if (audience.returning === "new" && visit.returning) return false;
  if (audience.returning === "returning" && !visit.returning) return false;
  return true;
}

/** Reads an audience from stored JSON, keeping only what is valid. */
export function parseAudience(value: unknown): Audience {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const markets = Array.isArray(v.markets) ? v.markets.filter((m): m is string => typeof m === "string" && /^[a-z]{2}(-[a-z0-9-]{1,12})?$/.test(m)).slice(0, 40) : [];
  const devices = Array.isArray(v.devices) ? DEVICES.filter((d) => (v.devices as unknown[]).includes(d)) : [];
  return {
    ...(markets.length > 0 && { markets }),
    ...(devices.length > 0 && devices.length < DEVICES.length && { devices }),
    ...(v.returning === "new" || v.returning === "returning" ? { returning: v.returning } : {}),
  };
}

/** The device class from a user-agent string: coarse, and the only thing kept of it. */
export function deviceOf(userAgent: string | null | undefined): Device {
  const ua = (userAgent ?? "").toLowerCase();
  if (/ipad|tablet|kindle|silk/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/.test(ua)) return "mobile";
  return "desktop";
}

/** Crawlers and scripts are never enrolled: they see the original, always. */
export const isBot = (userAgent: string | null | undefined): boolean =>
  !userAgent || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|monitor|curl|wget|python-requests|httpclient/i.test(userAgent);

// ---------------------------------------------------------------------------
// The cookies
// ---------------------------------------------------------------------------

// In `ab-cookie.ts` (with the version keys), which the visitor's scripts import: this module, with every goal's words, is the server's
// and the admin's.
export {
  COOKIE_DAYS,
  MARKER_COOKIE,
  OUTSIDE,
  dataCookieName,
  decodeAssignments,
  encodeAssignments,
  isUuid,
  type Assignments,
} from "./ab-cookie";

// ---------------------------------------------------------------------------
// Checking a test
// ---------------------------------------------------------------------------

/** `scope` is a part test's check of the version (see `partChanges()`); null for a test of the whole page. */
export type VariantDraft = { key: string; name: string; share: number; published: boolean; scope?: "ok" | "outside" | "missing" | "modal" | null };

/** What is wrong with a test about to start, in words an owner can act on; empty when it can start. */
export function startProblems(test: {
  name: string;
  goal: Goal | string;
  goalBlock: string | null;
  /** The page the goal `page` counts (phase 20). */
  goalPage?: string | null;
  trafficShare: number;
  variants: VariantDraft[];
  pagePublished: boolean;
  runningInStore: number;
  /** The store's plan's `ab_tests_running` (phase 21): null is the engine's most, 0 a plan without A/B tests. */
  planAllows?: number | null;
  pageIsSpecial: boolean;
  /** A working page (the cart, the checkout, …) is tested by a part of it, not as a whole. */
  needsPart?: boolean;
  /** The part under test, in words, for a part test. */
  partLabel?: string | null;
}): string[] {
  const problems: string[] = [];
  if (test.name.trim() === "") problems.push("Give the test a name.");
  if (!isGoal(test.goal)) problems.push("Choose what the test should improve.");
  else if (GOAL_WORDS[test.goal].needsBlock && !test.goalBlock) problems.push(BLOCK_CHOICE[GOAL_WORDS[test.goal].block ?? "button"].problem);
  else if (GOAL_WORDS[test.goal].needsPage && !test.goalPage) problems.push("Choose the page you want more visitors to go on to: one of the store's published pages.");
  if (!(test.trafficShare > 0 && test.trafficShare <= 1)) problems.push("The share of visitors in the test is more than 0 and at most 100 %.");
  if (!test.pagePublished) problems.push("Publish the page before testing it: a test shows it to real visitors.");
  if (test.pageIsSpecial) problems.push("The cookies page and the blog, search, 404, category and tag pages cannot be tested yet.");
  if (test.needsPart) problems.push("A working page is tested by a part of it, around the shop's own component, not as a whole: choose the part in the page builder with “A/B test this”.");
  const others = test.variants.filter((v) => v.key !== "a");
  if (!test.variants.some((v) => v.key === "a") || others.length === 0) problems.push("A test needs the original and at least one other version.");
  if (others.length > MAX_VARIANTS - 1) problems.push(`A test has at most ${MAX_VARIANTS} versions, the original included.`);
  const total = test.variants.reduce((sum, v) => sum + v.share, 0);
  if (Math.abs(total - 1) > 0.0005) problems.push("The shares of the versions must add up to 100 %.");
  for (const v of others) if (!v.published) problems.push(`Publish version ${v.key.toUpperCase()} before starting: it is what visitors will see.`);
  const part = test.partLabel ?? "the part under test";
  for (const v of others) {
    if (v.scope === "outside") problems.push(`Version ${v.key.toUpperCase()} changes more than ${part}. Put everything else back as it was, or test the whole page instead.`);
    if (v.scope === "missing") problems.push(`Version ${v.key.toUpperCase()} no longer has ${part}: a test needs the part in every version.`);
    if (v.scope === "modal") problems.push(`Version ${v.key.toUpperCase()} changes the address name of ${part}, or whether it is a modal: links to it elsewhere would stop working. Keep the address name and keep it a modal.`);
  }
  const allows = test.planAllows ?? null;
  if (allows === 0) problems.push(PLAN_WITHOUT_TESTS);
  else if (allows !== null && allows < MAX_RUNNING_PER_STORE && test.runningInStore >= allows) problems.push(planFullProblem(allows));
  else if (test.runningInStore >= MAX_RUNNING_PER_STORE) problems.push(`A store can run ${MAX_RUNNING_PER_STORE} tests at a time. Stop one first.`);
  return problems;
}

/** Said when a store's plan has no A/B tests (phase 21); the words are `problems.planNone`. */
export const PLAN_WITHOUT_TESTS = "Your plan does not include A/B tests. Choose a plan with them to test this.";

/** Said when a store runs as many tests as its plan allows (phase 21); the words are `problems.planFull`. */
export const planFullProblem = (max: number) => `Your plan runs up to ${max} at a time. Stop a test first, or choose a plan with more.`;

/** How many tests a store may run at once: its plan's limit, never more than the engine's. */
export const runningAllowed = (planAllows: number | null): number => Math.min(planAllows ?? MAX_RUNNING_PER_STORE, MAX_RUNNING_PER_STORE);

/** An even split between the versions, as shares that add up to one. */
export function evenSplit(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(1000 / count) / 1000;
  const shares = Array.from({ length: count }, () => base);
  shares[0] = Math.round((1 - base * (count - 1)) * 1000) / 1000;
  return shares;
}

/** Whether a running test is past the time it may keep counting: its planned end and a week's grace. */
export function overdue(plannedEnd: Date | null, startedAt: Date | null, now: Date): boolean {
  const hardStop = startedAt ? startedAt.getTime() + MAX_RUN_DAYS * 86_400_000 : Infinity;
  const graceEnd = plannedEnd ? plannedEnd.getTime() + AFTER_PLANNED_END_DAYS * 86_400_000 : Infinity;
  return now.getTime() >= Math.min(hardStop, graceEnd);
}
