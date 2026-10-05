/**
 * Planning a redirect import (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.4, 4.4), pure: the lines of a file are judged as one SET against what the
 * store has, in the order of the file, and each gets its findings and what an apply would do. The same function runs on a chunk at apply time, with the store
 * read again at that moment (the check is advice: a product may have been renamed and a source become live since).
 *
 * Rules (each has a test): a line is judged by `validateRedirect()`, the one check; a line that closes a loop with another line of the file or with a redirect the
 * store has is an error on the line that closes it (the later one); a chain is collapsed (the stored target is the final destination, with a warning naming the
 * hops); the same source twice is an error on the later line (`duplicate.in_file`: the first line wins); an address that already has a redirect is replaced or
 * kept by the option; nothing outside the file is touched and no redirect is ever deleted; the stored result of any file has no loop and no self-redirect, and
 * planning the same file again after it was applied finds every line unchanged.
 */
import { finding, type Finding, type ItemOutcome } from "./data-job";
import { REDIRECTS_MAX } from "./data-limits";
import { normaliseSource, type AddressContext } from "./redirect-path";
import type { RedirectLine } from "./redirect-csv";
import { validateRedirect, type RedirectIndex } from "./redirects";

export const EXISTING_CHOICES = ["replace", "skip"] as const;
export type ExistingChoice = (typeof EXISTING_CHOICES)[number];

/** What the member chooses: what happens when an address already has a redirect. Nothing else. */
export type RedirectImportOptions = { existing: ExistingChoice };
export const DEFAULT_REDIRECT_OPTIONS: RedirectImportOptions = { existing: "replace" };

/** Options as stored in a job (`options` jsonb): anything unknown is the default. */
export function parseRedirectOptions(raw: unknown): RedirectImportOptions {
  const value = raw && typeof raw === "object" ? (raw as { existing?: unknown }).existing : undefined;
  return { existing: value === "skip" ? "skip" : "replace" };
}

export type LineAction = "create" | "replace" | "unchanged" | "skip" | "error";

export type LinePlan = {
  row: number;
  /** The normalised source, or null when it could not be read. */
  source: string | null;
  /** The target to store (the final destination of a chain), null for an error line. */
  target: string | null;
  action: LineAction;
  /** What the item of the job says: `created`, `updated`, `unchanged`, `skipped` or `failed`. */
  outcome: Exclude<ItemOutcome, "drafted" | "checked">;
  findings: Finding[];
  /** The line replaces an automatic redirect (the apply deletes it in the same step). */
  replacesAutomatic: boolean;
};

export type PlanEnv = {
  ctx: AddressContext;
  live: ReadonlySet<string>;
  /** The store's redirects now. The plan lays the lines over a COPY; the arguments are not changed. */
  index: RedirectIndex;
  /** Manual redirects the store has now. */
  manualCount: number;
  options: RedirectImportOptions;
  limit?: number;
  /** The rows that repeat an earlier line's source (`duplicateRows()`): given for a chunk, worked out for a whole file. */
  duplicates?: ReadonlySet<number>;
};

const OUTCOME: Record<LineAction, LinePlan["outcome"]> = { create: "created", replace: "updated", unchanged: "unchanged", skip: "skipped", error: "failed" };

/** The rows of a file that repeat the source of an earlier row (their sources read to the same normal form); the first line of a source wins. */
export function duplicateRows(lines: readonly RedirectLine[], ctx: AddressContext): Set<number> {
  const seen = new Set<string>();
  const out = new Set<number>();
  for (const line of lines) {
    const read = normaliseSource(line.from, ctx);
    if (!read.ok) continue;
    if (seen.has(read.source)) out.add(line.row);
    else seen.add(read.source);
  }
  return out;
}

/**
 * Plans lines one after another against a copy of the store's redirects that grows with each line that would be written, so a later line sees the earlier
 * ones (a chain through them is collapsed, a loop through them refused). Returns one plan per line, in order.
 */
export function planRedirectLines(lines: readonly RedirectLine[], env: PlanEnv): LinePlan[] {
  const manual = new Map(env.index.manual);
  const automatic = new Map(env.index.automatic);
  let count = env.manualCount;
  const duplicates = env.duplicates ?? duplicateRows(lines, env.ctx);
  const limit = env.limit ?? REDIRECTS_MAX;
  const plans: LinePlan[] = [];

  for (const line of lines) {
    const check = validateRedirect({ from: line.from, to: line.to }, { ctx: env.ctx, live: env.live, index: { manual, automatic }, manualCount: count, limit });
    let findings = [...check.findings];
    // A repeat of an address is judged by the first line only: what the store (or that line) has for it is not news about this one.
    if (check.source !== null && duplicates.has(line.row)) findings = [...findings.filter((f) => !f.code.startsWith("exists.")), finding("duplicate.in_file", { address: check.source })];
    const failed = findings.some((f) => f.severity === "error");
    if (failed || check.source === null || check.target === null) {
      plans.push({ row: line.row, source: check.source, target: null, action: "error", outcome: "failed", findings, replacesAutomatic: false });
      continue;
    }
    let action: LineAction;
    let replacesAutomatic = false;
    if (check.existing?.kind === "manual") {
      action = check.findings.some((f) => f.code === "exists.same") ? "unchanged" : env.options.existing === "skip" ? "skip" : "replace";
    } else if (check.existing?.kind === "automatic") {
      action = env.options.existing === "skip" ? "skip" : "create";
      replacesAutomatic = action === "create";
    } else action = "create";
    // The check says an existing redirect is replaced; with the option to keep, the line is skipped and says so.
    let said = findings;
    if (action === "skip") said = [...findings.filter((f) => f.code !== "exists.update" && f.code !== "exists.replaced_automatic"), finding("exists.skipped", { address: check.source })];
    plans.push({ row: line.row, source: check.source, target: check.target, action, outcome: OUTCOME[action], findings: said, replacesAutomatic });
    if (action === "create" || action === "replace") {
      if (action === "create") {
        count += 1;
        automatic.delete(check.source);
      }
      manual.set(check.source, check.target);
    }
  }
  return plans;
}

/** What a finished check tells the member before they apply. */
export type RedirectDryRun = { toCreate: number; toReplace: number; unchanged: number; skipped: number; withErrors: number };

export const countPlans = (plans: readonly LinePlan[]): RedirectDryRun => ({
  toCreate: plans.filter((p) => p.action === "create").length,
  toReplace: plans.filter((p) => p.action === "replace").length,
  unchanged: plans.filter((p) => p.action === "unchanged").length,
  skipped: plans.filter((p) => p.action === "skip").length,
  withErrors: plans.filter((p) => p.action === "error").length,
});

export type RedirectImportPlan = { lines: LinePlan[]; dry: RedirectDryRun };

/** Plans a whole read file against the store: the dry run, and what an apply would write. */
export function planRedirectImport(lines: readonly RedirectLine[], env: Omit<PlanEnv, "duplicates">): RedirectImportPlan {
  const plans = planRedirectLines(lines, { ...env, duplicates: duplicateRows(lines, env.ctx) });
  return { lines: plans, dry: countPlans(plans) };
}

/** An item of the job for a line (a dry run's items say `checked` and keep the prediction in `changes.will`). */
export function redirectItemOf(
  plan: LinePlan,
  dry: boolean,
): { kind: "redirect"; ref: string | null; rows: number[]; outcome: ItemOutcome; messages: Finding[]; changes: Record<string, unknown> } {
  return {
    kind: "redirect",
    ref: plan.source,
    rows: [plan.row],
    outcome: dry ? "checked" : plan.outcome,
    messages: plan.findings,
    changes: { ...(dry ? { will: plan.outcome } : {}), ...(plan.replacesAutomatic ? { replacesAutomatic: true } : {}) },
  };
}

/** The redirects an apply writes for the plans of a chunk: the lines that create or replace, in the file's order. */
export const writesOf = (plans: readonly LinePlan[]): { source: string; target: string; replacesAutomatic: boolean }[] =>
  plans.flatMap((p) => ((p.action === "create" || p.action === "replace") && p.source !== null && p.target !== null ? [{ source: p.source, target: p.target, replacesAutomatic: p.replacesAutomatic }] : []));
