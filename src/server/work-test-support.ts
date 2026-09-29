import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * Stores and members for Work's integration tests (never imported by the app):
 * a store made the way an approved access request makes one, with its owner,
 * and an admin account added to it.
 */
export type WorkTestStore = { owner: Membership; admin: Membership };

export async function makeWorkStore(
  label: string,
  getStore: (slug: string) => Promise<unknown>,
): Promise<WorkTestStore> {
  const slug = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'W', ${label}) returning id`,
  );
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${label}, null)`);
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`,
  );
  const [adminAccount] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`admin-${slug}@example.com`}, 'Admin') returning id, email
  `);
  const store = (await getStore(slug)) as Membership["store"];
  await db().execute(sql`
    insert into commerce.store_members (store_id, account_id, role) values (${store.id}::uuid, ${String(adminAccount.id)}::uuid, 'admin')
  `);
  await db().execute(
    sql`update commerce.stores set modules = array_append(modules, 'work') where id = ${store.id}::uuid`,
  );
  return {
    owner: {
      account: { id: String(owner.id), email: String(owner.email), name: "Owner", platformAdmin: false },
      role: "owner",
      store,
    },
    admin: {
      account: { id: String(adminAccount.id), email: String(adminAccount.email), name: "Admin", platformAdmin: false },
      role: "admin",
      store,
    },
  };
}
