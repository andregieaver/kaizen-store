import { countWords } from "./admin-fill";
import { financeEn, type FinanceMessages } from "./admin-messages/finance.en";
import { formatChange, formatCount, formatNumber, formatPercent, type Delta } from "./analytics-core";

/**
 * How Finance and Payouts write numbers in the admin's language (D312 A9): the analytics formatters' own figures, with a decimal comma
 * where the language writes one (`nb`: "83,4 %"). Only how a figure is written changes, never the figure.
 */
export type FinanceNumbers = {
  count: (n: number | null | undefined) => string;
  percent: (ratio: number | null | undefined, digits?: number) => string;
  change: (delta: Delta | null | undefined, digits?: number) => string;
  days: (days: number | null | undefined) => string;
};

/** Whether the words write a decimal comma: the admin's Norwegian does, English does not. */
export const decimalComma = (words: FinanceMessages = financeEn) => words.numbers.decimal === ",";

/** A figure's decimal point written as the language writes it; digit groups and signs are left alone. */
export const withDecimals = (text: string, comma: boolean) => (comma ? text.replace(/(\d)\.(\d)/g, "$1,$2") : text);

/** The writers in the words' language (its decimal mark and the days' words), English unless given. */
export function financeNumbers(words: FinanceMessages = financeEn): FinanceNumbers {
  const comma = decimalComma(words);
  return {
    count: formatCount,
    percent: (ratio, digits) => withDecimals(formatPercent(ratio, digits), comma),
    change: (delta, digits) => withDecimals(formatChange(delta, digits), comma),
    days: (days) => {
      const w = words.returns.days;
      if (days === null || days === undefined || !Number.isFinite(days)) return "–";
      if (days < 0.5) return w.under;
      const rounded = Math.round(days * 10) / 10;
      return countWords(rounded, w, { n: withDecimals(formatNumber(rounded, Number.isInteger(rounded) ? 0 : 1), comma) });
    },
  };
}
