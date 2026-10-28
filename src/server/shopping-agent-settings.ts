import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { audit } from "./auth";

/**
 * The store's *Shopping agents* switch (D353): the only writer of `stores.shopping_agents`. Off by default; on, the store's UCP profile and
 * its MCP endpoint answer agents (`agentStore()`). The caller refreshes the store's cache tag.
 */
export async function setShoppingAgents(storeId: string, accountId: string, on: boolean): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.stores set shopping_agents = ${on} where id = ${storeId}::uuid and shopping_agents is distinct from ${on} and not (is_template or starter)
    returning 1
  `);
  if (rows.length > 0) await audit(accountId, storeId, on ? "store.shopping_agents_on" : "store.shopping_agents_off", {});
  return rows.length > 0;
}
