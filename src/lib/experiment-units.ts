import { compareToOriginal, normalCdf, splitCheckP, type VariantFigures } from "./experiment-results";
import { MIN_PER_ARM, type Rate } from "./experiment-stats";

/**
 * What the engine's tests count (D148, phase 7). A page test counts visitors who accepted statistics cookies; the search test (D77)
 * counts searches and the recommendations test (D140) counts tabs, each by an id the visitor never keeps, so those two store nothing
 * about anyone. The arithmetic is the engine's for all three: the same comparison of two rates, the same split check and the same
 * rule for calling a difference, so a test of any unit says "better", "worse" or "no clear difference" the same way. The two older
 * tests keep their own logs (`search_queries`, `recommendation_events`); only the counting of them is shared.
 */

export type Unit = "visitor" | "search" | "tab";

export const UNITS: Record<Unit, { one: string; many: string; /** The least of them each arm needs before a difference is read at all. */ floor: number }> = {
  visitor: { one: "visitor", many: "visitors", floor: MIN_PER_ARM },
  search: { one: "search", many: "searches", floor: MIN_PER_ARM },
  tab: { one: "tab", many: "tabs", floor: 100 },
};

/** How a difference is called clear: the engine's 95 % interval, or the recommendations test's two-proportion test (p under 0.05), each fixed before any result was in. */
export type Rule = "interval" | "pooled";

/** The p-value under which the pooled rule calls a difference clear. */
export const CLEAR = 0.05;

/** A split below this chance is not trusted: the assignment or the log is broken. */
export const BROKEN_SPLIT_P = 0.001;

export type Call = "few" | "better" | "worse" | "even" | "broken";

export type RateCall = {
  call: Call;
  /** The control's and the treatment's rates, null while one has no units. */
  control: number | null;
  treatment: number | null;
  /** Treatment minus control, and the 95 % interval around it (the interval rule); null while either has none. */
  diff: number | null;
  low: number | null;
  high: number | null;
  /** The pooled rule's two-sided p-value; null for the interval rule or when it cannot be worked out. */
  p: number | null;
};

const figures = (key: string, r: Rate): VariantFigures => ({ key, name: key, visitors: r.of, conversions: r.hits, money: null });

/** The split check of two arms given shares `controlShare` and `1 - controlShare`: the engine's chi-square check for any number of versions. */
export function splitP(controlCount: number, treatmentCount: number, controlShare: number): number {
  return splitCheckP([controlCount, treatmentCount], [controlShare, 1 - controlShare]);
}

/**
 * Whether the treatment's rate differs from the control's, by the rule fixed in advance. Nothing is called with a broken split
 * (`splitChance` under 0.001) or fewer than `floor` units in an arm. `lowerIsBetter` is for rates such as searches finding nothing:
 * the call is flipped, the numbers returned are not.
 */
export function callRates(control: Rate, treatment: Rate, options: { rule: Rule; floor: number; splitChance?: number; lowerIsBetter?: boolean }): RateCall {
  const { rule, floor } = options;
  const compared = compareToOriginal("rate", figures("a", control), figures("b", treatment), 1.96);
  const numbers: Omit<RateCall, "call" | "p"> = {
    control: control.of === 0 ? null : control.hits / control.of,
    treatment: treatment.of === 0 ? null : treatment.hits / treatment.of,
    diff: compared?.diff ?? null,
    low: rule === "interval" ? (compared?.low ?? null) : null,
    high: rule === "interval" ? (compared?.high ?? null) : null,
  };
  const without = (call: Call): RateCall => ({ call, ...numbers, p: null });
  if (options.splitChance !== undefined && options.splitChance < BROKEN_SPLIT_P) return without("broken");
  if (control.of < floor || treatment.of < floor || !compared) return without("few");
  if (rule === "interval") {
    const [low, high] = options.lowerIsBetter ? [-compared.high, -compared.low] : [compared.low, compared.high];
    return without(low > 0 ? "better" : high < 0 ? "worse" : "even");
  }
  // The pooled rule: a two-proportion z-test on units, each one independent.
  const pooled = (control.hits + treatment.hits) / (control.of + treatment.of);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / control.of + 1 / treatment.of));
  if (se === 0) return without("even");
  const z = compared.diff / se;
  const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  const treatmentHigher = compared.diff > 0;
  const better = options.lowerIsBetter ? !treatmentHigher : treatmentHigher;
  return { call: p < CLEAR ? (better ? "better" : "worse") : "even", ...numbers, p };
}

const percent = (r: number | null) => (r === null ? "none" : `${(r * 100).toLocaleString("en-GB", { maximumFractionDigits: r < 0.1 ? 2 : 1 })} %`);
const count = (n: number) => n.toLocaleString("en-GB");

/**
 * A call in the engine's plain words, for any unit. `measure` finishes "… of the searches …" (what the rate counts, such as "found
 * nothing"). The sentences state only what was counted; they never say why.
 */
export function sayCall(input: {
  unit: Unit;
  call: RateCall;
  control: Rate;
  treatment: Rate;
  controlName: string;
  treatmentName: string;
  measure: string;
  floor?: number;
  /** The units each arm was given in all, when the rate is of some of them (searches with results): what the sentence says it rests on. */
  units?: { control: number; treatment: number };
}): { headline: string; detail: string } {
  const { unit, call, control, treatment, controlName, treatmentName } = input;
  const words = UNITS[unit];
  const floor = input.floor ?? words.floor;
  const counted = input.units ?? { control: control.of, treatment: treatment.of };
  const basis = `${count(counted.control)} ${words.many} for ${controlName} and ${count(counted.treatment)} for ${treatmentName}`;
  const rates = `${treatmentName}: ${percent(call.treatment)} of ${words.many} ${input.measure}; ${controlName}: ${percent(call.control)}.`;
  switch (call.call) {
    case "broken":
      return {
        headline: `Something is wrong with how ${words.many} are divided, so the results cannot be trusted.`,
        detail: `${basis}: more uneven than the assignment can explain. Check the assignment and its log before reading anything into the figures.`,
      };
    case "few":
      return {
        headline: "Too early to say.",
        detail: `${basis} so far. Wait for at least ${count(floor)} ${words.many} in each.${call.treatment === null || call.control === null ? "" : ` ${rates}`}`,
      };
    case "better":
      return { headline: `${treatmentName} is better than ${controlName}.`, detail: `${rates} This is based on ${basis}.` };
    case "worse":
      return { headline: `${controlName} is better than ${treatmentName}.`, detail: `${rates} This is based on ${basis}.` };
    case "even":
      return { headline: `No clear difference between ${controlName} and ${treatmentName}.`, detail: `${rates} That is within what chance alone could do. This is based on ${basis}.` };
  }
}
