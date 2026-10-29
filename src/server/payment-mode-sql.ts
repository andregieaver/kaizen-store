import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * A payment made in a test mode, as `commerce.invoice_eligibility()` decides it (D159): a Stripe payment whose connected account is a test
 * account, or a payment whose own row says so (`payments.test_mode`: venue, exchange and Mollie payments). A Stripe payment's flag is always
 * false, since its mode is its account's, so a reader that asks only the flag takes every Stripe test payment for real money.
 * `p` is the payments row's alias in the query.
 */
export function testPayment(p: string): SQL {
  const a = sql.raw(p);
  return sql`(${a}.test_mode or (${a}.provider_account is not null and exists (select 1 from commerce.connected_accounts ca
    where ca.store_id = ${a}.store_id and ca.account_id = ${a}.provider_account and ca.mode = 'test')))`;
}
