/**
 * A flow's report in words (D767, email plan M3.8): what it brought in the last 30 days and one suggestion, chosen here in code from the
 * numbers (never by a model). Pure: `flowReport()` in `src/server/flows.ts` reads the numbers.
 */

export type FlowReport = {
  /** People who started it in the period. */
  entered: number;
  /** Its emails sent in the period. */
  sent: number;
  /** Paid orders credited to its emails (each order to the latest message its buyer got, D761), and their money per currency. */
  orders: number;
  minor: Record<string, number>;
  /** The step whose emails took the most orders, or null. */
  topStep: { id: string; orders: number } | null;
  /** People whose run ended because they had left the list. */
  left: number;
};

export type FlowSuggestion = "none" | "space_out" | "add_picks" | "build_on_top";

/** One suggestion: leaving outweighs everything; then no orders from emails sent; then building on the step that works. */
export function flowSuggestion(r: FlowReport): FlowSuggestion {
  if (r.entered >= 20 && r.left / r.entered > 0.05) return "space_out";
  if (r.sent >= 20 && r.orders === 0) return "add_picks";
  if (r.topStep && r.orders >= 3) return "build_on_top";
  return "none";
}
