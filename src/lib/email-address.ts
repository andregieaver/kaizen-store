/**
 * One way to compare and keep an email address (PSI DATA-04): surrounding spaces taken off and lower case, as every table that keys on an
 * address (customers, subscribers, staff, withdrawals, sign-in limits) stores and looks it up, matching `lower(email)` in SQL. The local
 * part is lower-cased too: providers treat it so in practice, and two rows for one person cost more than the rare case-sensitive mailbox.
 * `email-address.scan.test.ts` keeps new code from lower-casing an address by hand. Pure.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** Whether two addresses are the same person's by that rule. */
export const sameEmail = (a: string, b: string): boolean => normaliseEmail(a) === normaliseEmail(b);
