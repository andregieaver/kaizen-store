/**
 * The autopilot's purchasing budget (`docs/100-day-challenge.md` C3): the stock it may buy itself, per purchase order and per calendar month,
 * in the store's main currency (the owner funds the stock, so they set what it may spend). Pure: the order's total and the decision; the
 * server reads the month's orders.
 */

/** A purchase order's total at cost, in its currency's minor units: each line's units times its unit cost. */
export function purchaseTotalMinor(lines: readonly { quantity: number; unitCostMinor: number }[]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitCostMinor, 0);
}

export type PurchaseBudgetFacts = {
  /** The new order's total, in its own currency's minor units. */
  orderMinor: number;
  orderCurrency: string;
  /** The store's main currency, which the budget is in. */
  mainCurrency: string;
  /** What purchase orders placed this calendar month already add up to in the main currency; null when one is in another currency. */
  monthMinor: number | null;
  /** The budget per order and per month, in the main currency's minor units; null: none set. */
  perOrderMinor: number | null;
  monthlyMinor: number | null;
  /** Writes an amount for the reason. */
  money: (minor: number) => string;
};

/**
 * Why the autopilot must ask before placing this purchase order, or null when it may: without a budget every order asks; an order in another
 * currency than the budget's asks, as does a month that cannot be added up; and an order over either limit asks.
 */
export function purchaseBudgetProblem(f: PurchaseBudgetFacts): string | null {
  if (f.perOrderMinor === null && f.monthlyMinor === null) return "No purchasing budget is set, so every purchase order waits for your yes.";
  if (f.orderCurrency !== f.mainCurrency) return `The order is in ${f.orderCurrency}, and the purchasing budget is in ${f.mainCurrency}.`;
  if (f.perOrderMinor !== null && f.orderMinor > f.perOrderMinor) {
    return `The order comes to ${f.money(f.orderMinor)}, more than the ${f.money(f.perOrderMinor)} a purchase order may cost.`;
  }
  if (f.monthlyMinor !== null) {
    if (f.monthMinor === null) return "This month's purchase orders are in more than one currency, so the monthly budget cannot be counted.";
    if (f.monthMinor + f.orderMinor > f.monthlyMinor) {
      return `With this order the month's purchases come to ${f.money(f.monthMinor + f.orderMinor)}, more than the monthly budget of ${f.money(f.monthlyMinor)}.`;
    }
  }
  return null;
}
