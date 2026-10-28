import "server-only";

import { sql } from "drizzle-orm";
import { updateTag } from "next/cache";

import { db } from "@/db/client";
import { countWords, fillWords } from "@/lib/admin-fill";
import { shippingEn } from "@/lib/admin-messages/shipping.en";
import { FEATURES_NEEDING_ACCOUNTS, isAccountsMode, type AccountsMode } from "@/lib/customer-accounts";
import { featureOn } from "@/lib/store-features";

import { auditChange } from "./audit";
import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { storeTag } from "./stores";

type Row = Record<string, unknown>;
type Words = (typeof shippingEn)["customerAccounts"];

/**
 * Customer accounts (wave 10 unit B, D365): the only writer of `stores.customer_accounts`. `settings:write` changes it; accounts cannot be
 * switched off while a feature that needs them is on (subscriptions, the bonus programme, referrals) or a company account buys in the store, and
 * those features cannot be switched on while accounts are off (`setFeature()`). Audited `store.customer_accounts`.
 */
export async function saveAccountsMode(
  member: Membership,
  mode: unknown,
  words: Words = shippingEn.customerAccounts,
  featureLabel: (id: string) => string = (id) => id,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "settings:write")) return { ok: false, problems: ["Not allowed."] };
  if (!isAccountsMode(mode)) return { ok: false, problems: ["Choose optional, required or off."] };
  const { store } = member;
  if (mode === "off") {
    const problems: string[] = FEATURES_NEEDING_ACCOUNTS.filter((id) => featureOn(store, id)).map((id) => fillWords(words.blockedFeature, { label: featureLabel(id) }));
    const [companies] = await db().execute<Row>(sql`select count(*)::int as n from commerce.customer_companies where store_id = ${store.id}::uuid`);
    const n = Number(companies?.n ?? 0);
    if (n > 0) problems.push(countWords(n, words.blockedCompanies));
    if (problems.length > 0) return { ok: false, problems };
  }
  const was = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`select customer_accounts from commerce.stores where id = ${store.id}::uuid for update`);
    await tx.execute(sql`update commerce.stores set customer_accounts = ${mode} where id = ${store.id}::uuid`);
    return (isAccountsMode(row?.customer_accounts) ? row.customer_accounts : "optional") as AccountsMode;
  });
  if (was !== mode) {
    await auditChange(member, "store.customer_accounts", { type: "store", id: store.id, label: store.name }, { customerAccounts: was }, { customerAccounts: mode }, "store");
  }
  updateTag(storeTag(store.slug));
  return { ok: true };
}
