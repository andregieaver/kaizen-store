/**
 * One line of usage against a limit, as the screens draw it (D314): the figure, the share of the limit, its state and the signal to
 * colour it. Pure, so the views and their tests share it.
 */

import type { FormState } from "@/components/admin/action-form";

import type { Signal } from "./admin-schemes";
import { type Enforce, type LimitKey, type LimitOrigin, type LimitState, limitState } from "./limits";
import type { UsageMetric } from "./usage-metrics";

/** A form's server action as `ActionForm` takes it, for the usage screens' forms (kept here so the components hold no type words). */
export type FormAction<S> = (state: S, form: FormData) => Promise<S>;
/** A panel's action, and a row's (bound to the row's id). */
export type PanelAction = FormAction<FormState>;
export type RowAction = (id: string) => PanelAction;

export type UsageLine = {
  metric: UsageMetric;
  key: LimitKey;
  used: number;
  measured: boolean;
  estimated: boolean;
  limit: number | null;
  origin: LimitOrigin;
  enforce: Enforce;
  state: LimitState;
  /** The share of the limit used (0 when unlimited or not measured). */
  share: number;
  signal: Signal;
};

export function usageLine(input: Omit<UsageLine, "state" | "share" | "signal">): UsageLine {
  const state = input.measured ? limitState(input.used, input.limit) : "ok";
  const share = !input.measured || input.limit === null ? 0 : input.limit === 0 ? 1 : input.used / input.limit;
  // A soft limit is never a danger: the shop stays open.
  const signal: Signal = state === "ok" ? "positive" : state === "near" || input.enforce === "soft" ? "warning" : "danger";
  return { ...input, state, share, signal };
}

/** Whether any hard limit of the lines is reached or passed, for the control center and the Billing page's button. */
export const hardLimitReached = (lines: readonly UsageLine[]) => lines.some((l) => l.enforce === "hard" && (l.state === "reached" || l.state === "over"));
