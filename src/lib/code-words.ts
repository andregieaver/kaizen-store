import type { DiscountProblem } from "./discounts";

/**
 * Why a discount code does not apply, in the shopper's words (D31, D299 E2): the minimum with its amount, the code it cannot
 * be used with named, else the plain reason. `money` writes an amount as the page shows prices.
 */
export function codeProblemText(
  m: { codeProblems: Record<DiscountProblem, string>; minimumFor: string },
  problem: { problem: DiscountProblem; with?: string | null; minimumMinor?: number | null },
  money: (minor: number) => string,
): string {
  if (problem.problem === "minimum" && problem.minimumMinor) return `${m.minimumFor} ${money(problem.minimumMinor)}.`;
  if (problem.problem === "not_combinable") return m.codeProblems.not_combinable.replace("{code}", problem.with ?? "");
  return m.codeProblems[problem.problem];
}
