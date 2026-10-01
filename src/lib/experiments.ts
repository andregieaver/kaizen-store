/**
 * A/B tests of pages (D148, docs/ab-testing.md): the vocabulary, limits, cookies and the rules a test is checked with.
 * Pure and shared by the browser, the proxy, the server and the tests; the database holds the same rules (migration
 * `ab_experiments`).
 */

export const EXPERIMENT_STATUSES = ["draft", "running", "stopped", "applied", "discarded"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/** Where a test can go from where it is (the database refuses anything else). */
export const NEXT_STATUSES: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  draft: ["running", "discarded"],
  running: ["stopped"],
  stopped: ["applied", "discarded"],
  applied: [],
  discarded: [],
};

export const STATUS_WORDS: Record<ExperimentStatus, string> = {
  draft: "Draft",
  running: "Running",
  stopped: "Stopped",
  applied: "Winner applied",
  discarded: "Discarded",
};

export const MAX_RUNNING_PER_STORE = 5;
export const MAX_VARIANTS = 4;
export const MAX_RUN_DAYS = 90;
/** A test past its planned end keeps counting this long, then stops itself. */
export const AFTER_PLANNED_END_DAYS = 7;
/** The shortest a test runs before a verdict is given: whole weeks, so each weekday counts the same. */
export const MIN_DAYS = 14;
export const VARIANT_KEYS = ["a", "b", "c", "d"] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

export const GOALS = ["orders", "revenue", "cart", "checkout", "click"] as const;
export type Goal = (typeof GOALS)[number];

/** What each goal measures, in the words the admin uses. */
export const GOAL_WORDS: Record<Goal, { label: string; asks: string; per: string; kind: "rate" | "money"; needsBlock: boolean }> = {
  orders: { label: "More orders", asks: "get more of the visitors to buy", per: "placed an order", kind: "rate", needsBlock: false },
  revenue: { label: "More revenue per visitor", asks: "sell more per visitor", per: "revenue per visitor", kind: "money", needsBlock: false },
  cart: { label: "More people adding to the cart", asks: "get more visitors to add something to the cart", per: "added to the cart", kind: "rate", needsBlock: false },
  checkout: { label: "More people reaching checkout", asks: "get more visitors to start checkout", per: "started checkout", kind: "rate", needsBlock: false },
  click: { label: "More clicks on a button or link", asks: "get more visitors to click a chosen button or link", per: "clicked it", kind: "rate", needsBlock: true },
};

export const isGoal = (value: unknown): value is Goal => (GOALS as readonly unknown[]).includes(value);

/** Who is enrolled, beyond having accepted statistics: empty lists mean everyone. */
export type Audience = { markets?: string[]; devices?: Device[]; returning?: "new" | "returning" };
export const DEVICES = ["mobile", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

export type VisitContext = { market: string; device: Device; returning: boolean };

export function audienceAllows(audience: Audience | null | undefined, visit: VisitContext): boolean {
  if (!audience) return true;
  if (audience.markets && audience.markets.length > 0 && !audience.markets.includes(visit.market)) return false;
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

/**
 * `kaizen_ab=1` says "this browser has assignments"; the proxy's matcher can only look for one cookie name, so it is
 * the one it looks for. It holds nothing. The assignments are in `kaizen_ab_{storeId}`, one per store, so a visitor's
 * id is never the same at two stores.
 */
export const MARKER_COOKIE = "kaizen_ab";
export const dataCookieName = (storeId: string) => `kaizen_ab_${storeId}`;
export const COOKIE_DAYS = 90;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** A visitor's answer for a test they are not in (the traffic share, the audience): they see the original and are never counted. */
export const OUTSIDE = "0";
const isVersion = (value: unknown): value is string => value === OUTSIDE || (VARIANT_KEYS as readonly string[]).includes(value as string);

export type Assignments = { visitor: string; versions: Record<string, string> };

/** `1.{visitor}.{experiment}={variant},…`: the browser's own random id for this store, and the version it has for each test. */
export function encodeAssignments({ visitor, versions }: Assignments): string {
  const pairs = Object.entries(versions)
    .filter(([id, variant]) => isUuid(id) && isVersion(variant))
    .slice(0, 12)
    .map(([id, variant]) => `${id}=${variant}`)
    .join(",");
  return `1.${visitor}.${pairs}`;
}

export function decodeAssignments(value: string | undefined | null): Assignments | null {
  const match = /^1\.([0-9a-f-]{36})\.([0-9a-z=,-]{0,600})$/.exec(value ?? "");
  if (!match || !isUuid(match[1])) return null;
  const versions: Record<string, string> = {};
  for (const pair of match[2].split(",")) {
    const [id, variant] = pair.split("=");
    if (isUuid(id) && isVersion(variant)) versions[id] = variant;
  }
  return { visitor: match[1], versions };
}

/** The marker an A/B page carries for the browser, to compare with the cookie: `{experiment}.{variant}`. */
export const pageMarker = (experimentId: string, variant: string) => `${experimentId}.${variant}`;

// ---------------------------------------------------------------------------
// Checking a test
// ---------------------------------------------------------------------------

export type VariantDraft = { key: string; name: string; share: number; published: boolean };

/** What is wrong with a test about to start, in words an owner can act on; empty when it can start. */
export function startProblems(test: {
  name: string;
  goal: Goal | string;
  goalBlock: string | null;
  trafficShare: number;
  variants: VariantDraft[];
  pagePublished: boolean;
  runningInStore: number;
  pageIsSpecial: boolean;
}): string[] {
  const problems: string[] = [];
  if (test.name.trim() === "") problems.push("Give the test a name.");
  if (!isGoal(test.goal)) problems.push("Choose what the test should improve.");
  else if (GOAL_WORDS[test.goal].needsBlock && !test.goalBlock) problems.push("Choose the button or link whose clicks you want more of.");
  if (!(test.trafficShare > 0 && test.trafficShare <= 1)) problems.push("The share of visitors in the test is more than 0 and at most 100 %.");
  if (!test.pagePublished) problems.push("Publish the page before testing it: a test shows it to real visitors.");
  if (test.pageIsSpecial) problems.push("The front page, the All products page and pages chosen for a place of their own cannot be tested yet.");
  const others = test.variants.filter((v) => v.key !== "a");
  if (!test.variants.some((v) => v.key === "a") || others.length === 0) problems.push("A test needs the original and at least one other version.");
  if (others.length > MAX_VARIANTS - 1) problems.push(`A test has at most ${MAX_VARIANTS} versions, the original included.`);
  const total = test.variants.reduce((sum, v) => sum + v.share, 0);
  if (Math.abs(total - 1) > 0.0005) problems.push("The shares of the versions must add up to 100 %.");
  for (const v of others) if (!v.published) problems.push(`Publish version ${v.key.toUpperCase()} before starting: it is what visitors will see.`);
  if (test.runningInStore >= MAX_RUNNING_PER_STORE) problems.push(`A store can run ${MAX_RUNNING_PER_STORE} tests at a time. Stop one first.`);
  return problems;
}

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
