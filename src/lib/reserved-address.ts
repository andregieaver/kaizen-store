/**
 * Addresses that are never sent to (D792): `example.org` and `example.net` and anything under them, two of the domains RFC 2606 reserves for
 * documentation, so no person can have one. Mail to one is kept in the email log as `logged` and never handed to the sending service, so a
 * demo store's made-up customers (they use `example.org`) cannot bounce against the platform's sending reputation or reach anyone.
 *
 * Only these two: `example.com` and the reserved top-level domains (`.test`, `.example`, `.invalid`) are what the tests write to when they
 * check that an email really goes out through a stubbed Resend, so they stay deliverable. Pure: the senders (`sendEmail()`, the broadcast
 * batches) ask it before delivering.
 */

const NEVER_SENT = ["example.org", "example.net"] as const;

/** Whether an email address is on a domain that is never sent to; false for anything that is not an address. */
export function isReservedAddress(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 1) return false;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  return NEVER_SENT.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
}

/** What the email log says of mail that was kept and not sent because its address is reserved. */
export const RESERVED_NOTE = "not sent: a reserved test address";
