/**
 * Sequential order numbering (D141). Some countries require a store's order numbers to run one after the other without
 * gaps. `commerce.next_document_number()` gives each order its number inside the transaction that inserts it, the database
 * refuses to renumber, delete or reset what was issued, and `commerce.order_number_audit()` checks a store's sequence.
 */

export type OrderNumberAudit = {
  orders: number;
  firstNumber: number | null;
  lastNumber: number | null;
  missing: number;
  firstMissing: number | null;
  offFormat: number;
  nextNumber: number | null;
  ok: boolean;
};

/** What is wrong with the sequence, in plain words (empty when it is in order). */
export function auditProblems(audit: OrderNumberAudit): string[] {
  const problems: string[] = [];
  if (audit.missing > 0) {
    problems.push(
      `${audit.missing} order number(s) are missing between ${audit.firstNumber} and ${audit.lastNumber}` +
        (audit.firstMissing === null ? "." : `, the first being ${audit.firstMissing}.`),
    );
  }
  if (audit.offFormat > 0) problems.push(`${audit.offFormat} order(s) have a number that is not from the store's series.`);
  if (audit.lastNumber !== null && audit.nextNumber !== null && audit.nextNumber !== audit.lastNumber + 1) {
    problems.push(`The next number to be issued is ${audit.nextNumber}, but the last order is ${audit.lastNumber}.`);
  }
  return problems;
}
