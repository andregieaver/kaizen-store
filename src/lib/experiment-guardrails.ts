import { compareToOriginal, harmedVersion, type VariantFigures } from "./experiment-results";

/**
 * An A/B test's guardrails (D148 phase 19, `docs/ab-testing.md` "Goals"): what is watched whatever the test's goal, so a version that sells
 * more of one thing cannot quietly hurt another. Three can stop a test by themselves, each on a strict interval (z 3.29, as the orders one
 * always has) and only once every version has seen enough: fewer orders, slower pages, more failed payments at checkout. Refunds and returns
 * are read 30 days late, after most tests end, so they are said, never a stop. Pure: the server counts, this decides.
 */

export const GUARDRAILS = ["orders", "speed", "checkout", "returns"] as const;
export type Guardrail = (typeof GUARDRAILS)[number];

/** The guardrails that may stop a test; the kind is kept with the stop (`experiments.stop_guardrail`). */
export const STOPPING_GUARDRAILS = ["orders", "speed", "checkout"] as const satisfies readonly Guardrail[];
export type StoppingGuardrail = (typeof STOPPING_GUARDRAILS)[number];

export const isStoppingGuardrail = (value: unknown): value is StoppingGuardrail => (STOPPING_GUARDRAILS as readonly unknown[]).includes(value);

/** A load is slow when its main content took longer than this to show (LCP, Google's "good" limit, `SPEED_THRESHOLDS.lcp`). */
export const SLOW_LCP_MS = 2500;
/** Refunds and returns are counted when made within this many days of the order. */
export const RETURNS_DAYS = 30;

type Rule = {
  /** The least each version needs (visitors, page loads, checkouts, buyers) before anything is said. */
  min: number;
  /** How strict the interval is: 3.29 is about one in a thousand by chance. */
  z: number;
  /** For a share that should stay low, how much higher a version's must be (as a difference of shares) before it counts, whatever the interval. */
  floor: number;
  stops: boolean;
};

export const GUARDRAIL_RULES: Record<Guardrail, Rule> = {
  orders: { min: 1000, z: 3.29, floor: 0, stops: true },
  // A few points more slow loads is noise to a visitor; five in a hundred more is felt.
  speed: { min: 400, z: 3.29, floor: 0.05, stops: true },
  checkout: { min: 200, z: 3.29, floor: 0.02, stops: true },
  returns: { min: 100, z: 1.96, floor: 0, stops: false },
};

/** What a guardrail counted for one version: `n` people or page loads, `bad` of them the trouble watched (for orders, those who ordered). */
export type GuardrailCount = { key: string; n: number; bad: number };

export type GuardrailState =
  /** Not every version has the minimum yet. */
  | "watching"
  | "fine"
  /** A version is clearly worse: a stopping guardrail stops the test, the returns one warns. */
  | "worse"
  /** Not measured for this test: speed while the store does not count visits. */
  | "off";

export type GuardrailCheck = {
  kind: Guardrail;
  state: GuardrailState;
  /** The version that is clearly worse, for `worse`. */
  worst: string | null;
  min: number;
  versions: { key: string; n: number; bad: number; share: number | null }[];
  /** Refunds and returns: orders of the test are still within their 30 days. */
  stillComing?: boolean;
};

/** Whether a version's share of trouble is clearly above the original's: past the interval and past the floor. */
function clearlyHigher(original: GuardrailCount, version: GuardrailCount, rule: Rule): boolean {
  const c = compareToOriginal(
    "rate",
    { key: "a", name: "", visitors: original.n, conversions: original.bad, money: null },
    { key: version.key, name: "", visitors: version.n, conversions: version.bad, money: null },
    rule.z,
  );
  return c !== null && c.low > 0 && c.diff >= rule.floor;
}

/**
 * One guardrail's state from its counts (the original first or anywhere, key `a`). Orders are the one where the count is the good thing
 * (who ordered), so it keeps the rule it has had since phase 1 (`harmedVersion()`).
 */
export function checkGuardrail(kind: Guardrail, counts: readonly GuardrailCount[], options: { off?: boolean; stillComing?: boolean } = {}): GuardrailCheck {
  const rule = GUARDRAIL_RULES[kind];
  const versions = counts.map((c) => ({ key: c.key, n: c.n, bad: Math.min(c.bad, c.n), share: c.n > 0 ? Math.min(c.bad, c.n) / c.n : null }));
  const base = { kind, min: rule.min, versions, ...(kind === "returns" && { stillComing: options.stillComing ?? false }) };
  if (options.off) return { ...base, state: "off", worst: null };
  const original = versions.find((v) => v.key === "a");
  if (!original || versions.length < 2 || versions.some((v) => v.n < rule.min)) return { ...base, state: "watching", worst: null };
  let worst: string | null = null;
  if (kind === "orders") {
    const figures: VariantFigures[] = versions.map((v) => ({ key: v.key, name: v.key, visitors: v.n, conversions: v.bad, money: null }));
    worst = harmedVersion(figures, Object.fromEntries(versions.map((v) => [v.key, v.bad])));
  } else {
    worst = versions.find((v) => v.key !== "a" && clearlyHigher(original, v, rule))?.key ?? null;
  }
  return { ...base, state: worst ? "worse" : "fine", worst };
}

/** The first stopping guardrail that found a version clearly worse, in the order they are looked at: orders, checkout, speed. */
export function guardrailStop(checks: readonly GuardrailCheck[]): { kind: StoppingGuardrail; version: string } | null {
  for (const kind of ["orders", "checkout", "speed"] as const) {
    const check = checks.find((c) => c.kind === kind);
    if (check?.state === "worse" && check.worst) return { kind, version: check.worst };
  }
  return null;
}

/** The guardrail that warns without stopping, when it found a version worse (refunds and returns). */
export function guardrailWarning(checks: readonly GuardrailCheck[]): GuardrailCheck | null {
  return checks.find((c) => !GUARDRAIL_RULES[c.kind].stops && c.state === "worse") ?? null;
}

/** What a version that a stopping guardrail found does, in English (the platform's view and the AI manager read English). */
export const GUARDRAIL_HARM: Record<StoppingGuardrail, string> = {
  orders: "clearly lowers orders",
  speed: "loads clearly slower than the original",
  checkout: "fails clearly more payments at checkout",
};

/** What each guardrail counts, in English, for the AI manager's `explain_results`. */
export const GUARDRAIL_WATCHES: Record<Guardrail, { counted: string; watches: string }> = {
  orders: { counted: "visitors", watches: "Visitors who ordered: fewer than the original's stops the test." },
  speed: { counted: "page loads", watches: `Page loads that took more than ${SLOW_LCP_MS / 1000} seconds to show their main content: more than the original's stops the test.` },
  checkout: { counted: "visitors who started checkout", watches: "Visitors who started checkout, had a payment fail and did not order: more than the original's stops the test." },
  returns: {
    counted: "buyers",
    watches: `Buyers who asked to return something or got a refund within ${RETURNS_DAYS} days of the order: said, never a stop, as they come in late.`,
  },
};

/** Why a guardrail stopped a test, in English; a stop before phase 19 has no kind and was always for orders. */
export function guardrailStopReason(kind: StoppingGuardrail | null): string {
  if (kind === "speed") return "Kaizena Flow stopped it because a version loaded clearly slower than the original.";
  if (kind === "checkout") return "Kaizena Flow stopped it because clearly more payments failed at checkout in a version.";
  return "Kaizena Flow stopped it because a version was clearly selling less.";
}

/** Whether a test's orders can still be refunded or returned within the window: while it runs, and until 30 days after it stopped. */
export function returnsStillComing(stoppedAt: Date | null, now: Date): boolean {
  return stoppedAt === null || now.getTime() < stoppedAt.getTime() + RETURNS_DAYS * 86_400_000;
}
