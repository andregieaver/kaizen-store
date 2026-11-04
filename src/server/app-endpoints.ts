import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { installationTopics } from "@/lib/apps";

import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * An app's installations' own endpoints (wave 14 unit D2, D441): each live installation of an app that has an events address has one
 * endpoint in its store (`webhook_endpoints.app_grant_id`), its address and secret the app's (the same sealed text, never opened here), its
 * topics the app's that the installation's scopes read and `customer.erased` always (`installationTopics()`). It is not the owner's to see,
 * change or count in their ten (`webhook-endpoints.ts` reads only endpoints without an installation). Ending an installation switches it off
 * and queues `app.uninstalled` and `store.erase_requested` (the database's `app_installation_ended()`).
 */

const installationRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  account_id: col.uuid,
  scopes: z.array(z.string()),
  name: col.text,
  url: col.textOrNull,
  hint: col.textOrNull,
  secret: col.textOrNull,
  topics: z.array(z.string()),
});

/**
 * Makes an installation's endpoint as its app's events say now: made or brought up to date when the app has an events address (its
 * address, secret and topics), taken away when it has none. A live installation's endpoint that the app's new address replaces is switched
 * on again, with its failures forgotten; one the old address left failing stays as it is. Nothing for an installation that has ended.
 */
export async function syncInstallationEndpoint(executor: Executor, grantId: string): Promise<void> {
  const row = await typedRow(
    installationRow,
    sql`
      select g.id, g.store_id, g.account_id, g.scopes, c.name, a.webhook_url_encrypted as url, a.webhook_hint as hint,
        a.webhook_secret_encrypted as secret, a.webhook_topics as topics
      from commerce.oauth_grants g
      join commerce.oauth_clients c on c.id = g.client_id
      join commerce.apps a on a.client_id = g.client_id
      where g.id = ${grantId}::uuid and g.resource = 'admin' and g.revoked_at is null and g.store_id is not null
    `,
    executor,
  );
  if (!row) return;
  if (!row.url || !row.hint || !row.secret) {
    await executor.execute(sql`delete from commerce.webhook_endpoints where app_grant_id = ${row.id}::uuid`);
    return;
  }
  const topics = installationTopics(row.topics, row.scopes);
  await executor.execute(sql`
    insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics, app_grant_id, created_by)
    values (${row.store_id}::uuid, ${row.name.slice(0, 80)}, ${row.url}, ${row.hint}, ${row.secret},
      array[${sql.join(
        topics.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[], ${row.id}::uuid, ${row.account_id}::uuid)
    on conflict (app_grant_id) do update set
      name = excluded.name,
      hint = excluded.hint,
      secret_encrypted = excluded.secret_encrypted,
      topics = excluded.topics,
      enabled = case when commerce.webhook_endpoints.url_encrypted is distinct from excluded.url_encrypted then true else commerce.webhook_endpoints.enabled end,
      disabled_reason = case when commerce.webhook_endpoints.url_encrypted is distinct from excluded.url_encrypted then null else commerce.webhook_endpoints.disabled_reason end,
      failing_since = case when commerce.webhook_endpoints.url_encrypted is distinct from excluded.url_encrypted then null else commerce.webhook_endpoints.failing_since end,
      url_encrypted = excluded.url_encrypted,
      updated_at = now()
  `);
}

/** Every live installation of an app follows its events at once: its address, secret or topics changed (D2). */
export async function syncAppEndpoints(clientRowId: string, executor: Executor = db()): Promise<number> {
  const grants = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.oauth_grants where client_id = ${clientRowId}::uuid and resource = 'admin' and revoked_at is null`,
    executor,
  );
  for (const grant of grants) await syncInstallationEndpoint(executor, grant.id);
  return grants.length;
}
