import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { audit } from "./auth";
import { refreshStoreById } from "./stores";

/**
 * The store's *Shopping agents* switch (D353): the only writer of `stores.shopping_agents`. Off by default; on, the store's UCP profile and
 * its MCP endpoint answer agents (`agentStore()`). It refreshes the store's cache tag itself (DATA-02).
 */
export async function setShoppingAgents(storeId: string, accountId: string, on: boolean): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.stores set shopping_agents = ${on} where id = ${storeId}::uuid and shopping_agents is distinct from ${on} and not (is_template or starter)
    returning 1
  `);
  if (rows.length > 0) {
    await audit(accountId, storeId, on ? "store.shopping_agents_on" : "store.shopping_agents_off", {});
    await refreshStoreById(storeId);
  }
  return rows.length > 0;
}
