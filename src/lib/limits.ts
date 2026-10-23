/**
 * The limits a plan, an owner or a store can have (D314, `docs/capacity.md` 4). Numbers are never here: they are rows of
 * `commerce.plan_limits` and `commerce.limit_overrides` the platform admin edits; this file says only which metric a limit compares,
 * over which period, and whether reaching it refuses an action (`hard`) or only warns (`soft`). Storefront traffic is always soft: a
 * shop is never taken offline for being busy. Pure: the browser may import it.
 */

import type { UsageMetric } from "./usage-metrics";

export type Enforce = "hard" | "soft";
export type LimitScope = "store" | "owner";
export type LimitPeriod = "now" | "month";

type LimitDef = { metric: UsageMetric | null; period: LimitPeriod; enforce: Enforce; scope: LimitScope };

export const LIMITS = {
  storage_bytes: { metric: "storage_bytes", period: "now", enforce: "hard", scope: "store" },
  products: { metric: "products", period: "now", enforce: "hard", scope: "store" },
  staff_seats: { metric: "staff_seats", period: "now", enforce: "hard", scope: "store" },
  custom_domains: { metric: "custom_domains", period: "now", enforce: "hard", scope: "store" },
  marketing_emails_month: { metric: "marketing_emails", period: "month", enforce: "hard", scope: "store" },
  ai_cost_month_micros: { metric: "ai_cost_micros", period: "month", enforce: "hard", scope: "store" },
  requests_month: { metric: "requests", period: "month", enforce: "soft", scope: "store" },
  egress_bytes_month: { metric: "egress_bytes", period: "month", enforce: "soft", scope: "store" },
  /** How many stores an owner may have; counted live, never metered. */
  stores_owned: { metric: null, period: "now", enforce: "hard", scope: "owner" },
} as const satisfies Record<string, LimitDef>;

export type LimitKey = keyof typeof LIMITS;
export const LIMIT_KEYS = Object.keys(LIMITS) as LimitKey[];
export const STORE_LIMIT_KEYS = LIMIT_KEYS.filter((k) => LIMITS[k].scope === "store");

export function isLimitKey(value: unknown): value is LimitKey {
  return typeof value === "string" && (LIMIT_KEYS as string[]).includes(value);
}

/** A source of a limit: absent (no row), or a row whose value is a number or null (unlimited). */
export type LimitSource = { value: number | null } | undefined;
export type LimitOrigin = "override" | "plan" | "platform" | "none";

/** The first source that is set, in the order override, plan, platform; nothing set is unlimited. */
export function effectiveLimit(sources: { override?: LimitSource; plan?: LimitSource; platform?: LimitSource }): { value: number | null; origin: LimitOrigin } {
  if (sources.override) return { value: sources.override.value, origin: "override" };
  if (sources.plan) return { value: sources.plan.value, origin: "plan" };
  if (sources.platform) return { value: sources.platform.value, origin: "platform" };
  return { value: null, origin: "none" };
}

export type LimitState = "ok" | "near" | "reached" | "over";

/** Where usage stands against a limit: near from 80 %, reached from 100 %, over above it. Unlimited is always ok. */
export function limitState(used: number, limit: number | null): LimitState {
  if (limit === null) return "ok";
  if (limit === 0) return used > 0 ? "over" : "reached";
  if (used > limit) return "over";
  if (used >= limit) return "reached";
  return used * 5 >= limit * 4 ? "near" : "ok";
}

/** What is left under a limit; unlimited is Infinity. */
export function roomLeft(used: number, limit: number | null): number {
  return limit === null ? Infinity : Math.max(0, limit - used);
}

/** Whether adding `adding` would pass a hard limit. A soft limit never refuses. */
export function wouldPass(key: LimitKey, used: number, limit: number | null, adding: number): boolean {
  if (LIMITS[key].enforce === "soft" || limit === null) return false;
  return used + adding > limit;
}

/** Bytes in a gibibyte, the unit owners type storage and bandwidth in. */
export const GIB = 1024 ** 3;

/** The unit a limit is typed and shown in. */
export function limitUnit(key: LimitKey): "gb" | "count" | "money" {
  if (key === "storage_bytes" || key === "egress_bytes_month") return "gb";
  if (key === "ai_cost_month_micros") return "money";
  return "count";
}

/** A typed value in its unit to the stored integer (GB to bytes, dollars to micros); null when not a number at least 0. */
export function fromTyped(key: LimitKey, typed: string): number | null {
  const text = typed.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const unit = limitUnit(key);
  const number = Number(text);
  if (unit === "gb") return Math.round(number * GIB);
  if (unit === "money") return Math.round(number * 1_000_000);
  return Number.isInteger(number) ? number : null;
}

/** A stored value in its unit, for a field. */
export function toTyped(key: LimitKey, value: number): string {
  const unit = limitUnit(key);
  if (unit === "gb") return String(Math.round((value / GIB) * 100) / 100);
  if (unit === "money") return String(Math.round(value / 10_000) / 100);
  return String(value);
}

/** A cell of the limits editor as typed: not set (`unset`), unlimited, or a stored integer. */
export type LimitCell = { kind: "unset" } | { kind: "unlimited" } | { kind: "value"; value: number };

/**
 * The limits editor's form (`v:{plan}:{key}` the typed value, `u:{plan}:{key}` the Unlimited tick; `default` is the platform default),
 * for the plans shown. A cell typed wrong is named by its limit's key in `problems`.
 */
export function parseLimitsForm(data: FormData, planIds: readonly string[]): { cells: { planId: string | null; key: LimitKey; cell: LimitCell }[]; problems: LimitKey[] } {
  const cells: { planId: string | null; key: LimitKey; cell: LimitCell }[] = [];
  const problems = new Set<LimitKey>();
  for (const plan of ["default", ...planIds]) {
    for (const key of LIMIT_KEYS) {
      const unlimited = data.get(`u:${plan}:${key}`) === "on";
      const typed = String(data.get(`v:${plan}:${key}`) ?? "").trim();
      let cell: LimitCell = { kind: "unset" };
      if (unlimited) cell = { kind: "unlimited" };
      else if (typed !== "") {
        const value = fromTyped(key, typed);
        if (value === null) problems.add(key);
        else cell = { kind: "value", value };
      }
      cells.push({ planId: plan === "default" ? null : plan, key, cell });
    }
  }
  return { cells, problems: [...problems] };
}
