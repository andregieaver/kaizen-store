import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { APPS_MAX, DEVELOPER_TERMS_VERSION, isAppScope, normaliseAppScopes, type AppDistribution, type AppInput, type AppScope } from "@/lib/apps";
import { isEvent, type IntegrationEvent } from "@/lib/integrations";
import { safeClientName } from "@/lib/oauth";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { checkEndpointUrl } from "@/lib/webhook-signature";

import { syncAppEndpoints } from "./app-endpoints";
import { audit, type Account } from "./auth";
import { secretHash } from "./oauth-clients";
import { hostProblem } from "./replicate-fetch";
import { encryptionKey } from "./settings";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Apps for many stores (wave 14 unit D, D441): the only writer of `commerce.developers` and `commerce.apps`, and of the `oauth_clients` rows
 * of `kind = 'app'`. An account turns on developer mode by accepting the developer terms, then makes apps: each an OAuth client of
 * Kaizena Flow's authorization server (D439) with a secret, kept only as its SHA-256 and shown once, and an events secret kept encrypted
 * (it signs) and shown once. Installing an app is the authorization server's (`approveInstallation()` in `oauth.ts`).
 */

// Developer mode -------------------------------------------------------------------------------------------------------------------

export type Developer = { termsVersion: string; acceptedAt: string };

export async function developerOf(accountId: string): Promise<Developer | null> {
  const row = await typedRow(
    z.object({ terms_version: col.text, accepted_at: col.timestamp }),
    sql`select terms_version, accepted_at from commerce.developers where account_id = ${accountId}::uuid`,
  );
  return row ? { termsVersion: row.terms_version, acceptedAt: row.accepted_at } : null;
}

/** The account accepts the developer terms of this version and may make apps; accepting again records the newer version. */
export async function becomeDeveloper(account: Account): Promise<void> {
  await db().execute(sql`
    insert into commerce.developers (account_id, terms_version) values (${account.id}::uuid, ${DEVELOPER_TERMS_VERSION})
    on conflict (account_id) do update set terms_version = excluded.terms_version, accepted_at = now()
  `);
  await audit(account.id, null, "account.developer_terms_accepted", { version: DEVELOPER_TERMS_VERSION }, { area: "account" });
}

// An app as the developer sees it --------------------------------------------------------------------------------------------------

export type AppView = {
  id: string;
  clientRowId: string;
  clientId: string;
  name: string;
  logoUrl: string | null;
  description: string;
  homepageUrl: string | null;
  privacyUrl: string | null;
  supportEmail: string | null;
  redirectUris: string[];
  scopes: AppScope[];
  distribution: AppDistribution;
  listing: "requested" | "approved" | "declined" | null;
  listingNote: string | null;
  webhookHint: string | null;
  webhookTopics: IntegrationEvent[];
  blocked: boolean;
  verified: boolean;
  installations: number;
  createdAt: string;
};

const appRow = z.object({
  id: col.uuid,
  client_row: col.uuid,
  client_id: col.text,
  name: col.text,
  logo_url: col.textOrNull,
  description: col.text,
  homepage_url: col.textOrNull,
  privacy_url: col.textOrNull,
  support_email: col.textOrNull,
  redirect_uris: z.array(z.string()),
  scopes: z.array(z.string()),
  distribution: z.enum(["private", "unlisted", "listed"]),
  listing: z.enum(["requested", "approved", "declined"]).nullable(),
  listing_note: col.textOrNull,
  webhook_hint: col.textOrNull,
  webhook_topics: z.array(z.string()),
  blocked: col.bool,
  verified: col.bool,
  installations: col.int,
  created_at: col.timestamp,
  developer_id: col.uuid.nullable(),
});

const APP_SELECT = sql`
  select a.id, c.id as client_row, c.client_id, c.name, c.logo_url, a.description, a.homepage_url, a.privacy_url, a.support_email,
    c.redirect_uris, a.scopes, a.distribution, a.listing, a.listing_note, a.webhook_hint, a.webhook_topics,
    (c.blocked_at is not null) as blocked, c.verified,
    (select count(*)::int from commerce.oauth_grants g where g.client_id = c.id and g.resource = 'admin' and g.revoked_at is null) as installations,
    a.created_at, a.developer_id
  from commerce.apps a join commerce.oauth_clients c on c.id = a.client_id`;

const viewOf = (row: z.infer<typeof appRow>): AppView => ({
  id: row.id,
  clientRowId: row.client_row,
  clientId: row.client_id,
  name: safeClientName(row.name),
  logoUrl: row.logo_url,
  description: row.description,
  homepageUrl: row.homepage_url,
  privacyUrl: row.privacy_url,
  supportEmail: row.support_email,
  redirectUris: row.redirect_uris,
  scopes: row.scopes.filter(isAppScope),
  distribution: row.distribution,
  listing: row.listing,
  listingNote: row.listing_note,
  webhookHint: row.webhook_hint,
  webhookTopics: row.webhook_topics.filter(isEvent),
  blocked: row.blocked,
  verified: row.verified,
  installations: row.installations,
  createdAt: row.created_at,
});

/** The developer's apps, newest first. */
export async function appsOf(accountId: string): Promise<AppView[]> {
  return (await typedRows(appRow, sql`${APP_SELECT} where a.developer_id = ${accountId}::uuid order by a.created_at desc, a.id`)).map(viewOf);
}

/** One of the developer's own apps; null for another's or none. */
export async function ownApp(accountId: string, appId: string): Promise<AppView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(appId)) return null;
  const row = await typedRow(appRow, sql`${APP_SELECT} where a.id = ${appId}::uuid and a.developer_id = ${accountId}::uuid`);
  return row ? viewOf(row) : null;
}

/** The app behind an OAuth client, for the consent screen and the token's checks; null when the client is no app. */
export async function appOfClient(clientRowId: string): Promise<(AppView & { developerId: string | null }) | null> {
  const row = await typedRow(appRow, sql`${APP_SELECT} where c.id = ${clientRowId}::uuid`);
  return row ? { ...viewOf(row), developerId: row.developer_id } : null;
}

// Making and changing an app --------------------------------------------------------------------------------------------------------

const newSecret = (prefix: string, bytes: number) => `${prefix}${randomBytes(bytes).toString("base64url")}`;

/** What is shown once: the client's secret and the events secret. */
export type Shown = { clientId: string; secret?: string; webhookSecret?: string };

export type AppOutcome = { ok: true; id: string; shown: Shown } | { ok: false; problems: Record<string, string> };

/** The events address checked as an owner's endpoint is (`checkEndpointUrl()`, the address guard), or a problem. */
async function webhookOf(url: string | null): Promise<{ ok: true; value: { url: string; hint: string } | null } | { ok: false; problem: string }> {
  if (!url) return { ok: true, value: null };
  const checked = checkEndpointUrl(url);
  if (!checked.ok) return { ok: false, problem: checked.problem };
  const blocked = await hostProblem(new URL(checked.url).hostname);
  if (blocked) return { ok: false, problem: "That address cannot be reached from Kaizena Flow: use a public https:// address." };
  return { ok: true, value: { url: checked.url, hint: checked.hint } };
}

const textArray = (values: readonly string[]) => (values.length === 0 ? sql`'{}'::text[]` : sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`);

/**
 * A new app for a developer: its OAuth client (`kfapp_…`, a secret `kfas_…` shown once, its redirect URIs), and the app (`listed` asks
 * for Kaizena Flow's review: `listing = 'requested'`). At most `APPS_MAX` an account.
 */
export async function createApp(account: Account, input: AppInput): Promise<AppOutcome> {
  if (!(await developerOf(account.id))) return { ok: false, problems: { form: "Turn on developer mode first." } };
  if (input.webhookTopics.length > 0 && !input.webhookUrl) return { ok: false, problems: { webhook_url: "Give the address the events go to." } };
  const hook = await webhookOf(input.webhookUrl);
  if (!hook.ok) return { ok: false, problems: { webhook_url: hook.problem } };
  const key = encryptionKey();
  if (!key) return { ok: false, problems: { form: "Apps cannot be made here: the server has no encryption key." } };
  const clientId = newSecret("kfapp_", 16);
  const secret = newSecret("kfas_", 32);
  const webhookSecret = newSecret("kfws_", 32);
  const id = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('apps'), hashtext(${account.id}))`);
    const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.apps where developer_id = ${account.id}::uuid`);
    if (Number(count.n) >= APPS_MAX) return null;
    const [client] = await tx.execute<{ id: string }>(sql`
      insert into commerce.oauth_clients (kind, client_id, name, logo_url, client_uri, redirect_uris, application_type, secret_hash)
      values ('app', ${clientId}, ${input.name}, ${input.logoUrl}, ${input.homepageUrl}, ${textArray(input.redirectUris)}, 'web', ${secretHash(secret)})
      returning id
    `);
    const [app] = await tx.execute<{ id: string }>(sql`
      insert into commerce.apps (client_id, developer_id, description, homepage_url, privacy_url, support_email, scopes,
        webhook_url_encrypted, webhook_hint, webhook_secret_encrypted, webhook_topics, distribution, listing, listing_at)
      values (${client.id}::uuid, ${account.id}::uuid, ${input.description}, ${input.homepageUrl}, ${input.privacyUrl}, ${input.supportEmail},
        ${textArray(normaliseAppScopes(input.scopes))},
        ${hook.value ? encryptSecret(hook.value.url, key) : null}, ${hook.value?.hint ?? null}, ${encryptSecret(webhookSecret, key)},
        ${textArray(input.webhookTopics)}, ${input.distribution},
        ${input.distribution === "listed" ? "requested" : null}, ${input.distribution === "listed" ? sql`now()` : sql`null`})
      returning id
    `);
    return String(app.id);
  });
  if (!id) return { ok: false, problems: { form: `An account makes at most ${APPS_MAX} apps.` } };
  await audit(account.id, null, "account.app_made", { app: input.name, client_id: clientId, scopes: input.scopes, distribution: input.distribution }, { area: "account", target: { type: "app", id } });
  return { ok: true, id, shown: { clientId, secret, webhookSecret } };
}

/**
 * The developer changes their app: its client (name, logo, homepage, redirect URIs) and the app. Asking for `listed` again after a
 * decline asks for review again; leaving `listed` keeps the review's record. Installations keep the scopes they were given until their
 * store approves the new list (D2); their events address and topics follow at once (D2).
 */
export async function updateApp(account: Account, appId: string, input: AppInput): Promise<AppOutcome> {
  const app = await ownApp(account.id, appId);
  if (!app) return { ok: false, problems: { form: "No such app." } };
  const hook = await webhookOf(input.webhookUrl);
  if (!hook.ok) return { ok: false, problems: { webhook_url: hook.problem } };
  // An empty address keeps the one the app has (it is kept encrypted, so the form cannot show it); *Stop sending events* takes it away.
  const keeps = !input.webhookClear && !hook.value && app.webhookHint !== null;
  if (input.webhookTopics.length > 0 && !hook.value && !keeps) return { ok: false, problems: { webhook_url: "Give the address the events go to." } };
  const key = encryptionKey();
  if (!key) return { ok: false, problems: { form: "Apps cannot be changed here: the server has no encryption key." } };
  const askListing = input.distribution === "listed" && app.listing !== "approved" && app.listing !== "requested";
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.oauth_clients set name = ${input.name}, logo_url = ${input.logoUrl}, client_uri = ${input.homepageUrl},
        redirect_uris = ${textArray(input.redirectUris)}
      where id = ${app.clientRowId}::uuid
    `);
    await tx.execute(sql`
      update commerce.apps set description = ${input.description}, homepage_url = ${input.homepageUrl}, privacy_url = ${input.privacyUrl},
        support_email = ${input.supportEmail}, scopes = ${textArray(normaliseAppScopes(input.scopes))},
        ${keeps ? sql`` : sql`webhook_url_encrypted = ${hook.value ? encryptSecret(hook.value.url, key) : null}, webhook_hint = ${hook.value?.hint ?? null},`}
        webhook_topics = ${textArray(input.webhookTopics)}, distribution = ${input.distribution},
        ${askListing ? sql`listing = 'requested', listing_note = null, listing_at = now(),` : sql``}
        updated_at = now()
      where id = ${app.id}::uuid
    `);
    // Its installations' endpoints follow at once: the address, the secret and the topics each installation's scopes read (D2).
    await syncAppEndpoints(app.clientRowId, tx);
  });
  await audit(account.id, null, "account.app_changed", { app: input.name, client_id: app.clientId, scopes: input.scopes, distribution: input.distribution }, { area: "account", target: { type: "app", id: app.id } });
  return { ok: true, id: app.id, shown: { clientId: app.clientId } };
}

/** A new client secret or events secret for the developer's app, shown once; the old one stops working at once. */
export async function renewAppSecret(account: Account, appId: string, which: "client" | "webhook"): Promise<AppOutcome> {
  const app = await ownApp(account.id, appId);
  if (!app) return { ok: false, problems: { form: "No such app." } };
  if (which === "client") {
    const secret = newSecret("kfas_", 32);
    await db().execute(sql`update commerce.oauth_clients set secret_hash = ${secretHash(secret)} where id = ${app.clientRowId}::uuid`);
    await audit(account.id, null, "account.app_secret_renewed", { app: app.name, client_id: app.clientId }, { area: "account", target: { type: "app", id: app.id } });
    return { ok: true, id: app.id, shown: { clientId: app.clientId, secret } };
  }
  const key = encryptionKey();
  if (!key) return { ok: false, problems: { form: "The server has no encryption key." } };
  const webhookSecret = newSecret("kfws_", 32);
  await db().transaction(async (tx) => {
    await tx.execute(sql`update commerce.apps set webhook_secret_encrypted = ${encryptSecret(webhookSecret, key)}, updated_at = now() where id = ${app.id}::uuid`);
    await syncAppEndpoints(app.clientRowId, tx);
  });
  await audit(account.id, null, "account.app_webhook_secret_renewed", { app: app.name, client_id: app.clientId }, { area: "account", target: { type: "app", id: app.id } });
  return { ok: true, id: app.id, shown: { clientId: app.clientId, webhookSecret } };
}

/** The app's events address and secret in the clear, for its installations' endpoints (D2); null when it has no address. */
export async function appWebhook(appId: string): Promise<{ url: string; secret: string; topics: IntegrationEvent[] } | null> {
  const row = await typedRow(
    z.object({ url: col.textOrNull, secret: col.textOrNull, topics: z.array(z.string()) }),
    sql`select webhook_url_encrypted as url, webhook_secret_encrypted as secret, webhook_topics as topics from commerce.apps where id = ${appId}::uuid`,
  );
  const key = encryptionKey();
  if (!row?.url || !row.secret || !key) return null;
  return { url: decryptSecret(row.url, key), secret: decryptSecret(row.secret, key), topics: row.topics.filter(isEvent) };
}
