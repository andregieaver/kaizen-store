import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  clientHost,
  GRANT_ENDED_NOTE,
  isMetadataClientId,
  safeClientName,
  metadataLifetime,
  METADATA_MAX_BYTES,
  METADATA_TIMEOUT_MS,
  readClientMetadata,
  readRegistration,
  type ApplicationType,
} from "@/lib/oauth";

import { audit, type Account } from "./auth";
import { log } from "./log";
import { safeFetch, type FetchOptions, type Fetched } from "./replicate-fetch";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The clients of Kaizena Flow's authorization server (wave 14 unit B, D439): the only writer of `commerce.oauth_clients`. A client whose id
 * is an HTTPS address is read from its Client ID Metadata Document, fetched through `safeFetch()` (a public address, HTTPS, five seconds,
 * at most 64 KB, no redirect), checked (`readClientMetadata()`) and kept for what its cache headers allow, at most a day; any other is one
 * registered here (RFC 7591, public only) or made by Kaizena Flow. A platform admin verifies or blocks a client; a blocked client's grants
 * end at once and it can never ask again.
 */

export type ClientKind = "metadata_document" | "registered" | "preregistered" | "app";

export type OAuthClient = {
  id: string;
  kind: ClientKind;
  clientId: string;
  name: string;
  logoUrl: string | null;
  clientUri: string | null;
  redirectUris: string[];
  applicationType: ApplicationType | null;
  verified: boolean;
  blocked: boolean;
  /** A confidential client (an app): it authenticates at the token endpoint with its secret (`client_secret_basic`). */
  confidential: boolean;
  /** The host a person is shown for it (`clientHost()`). */
  host: string;
  createdAt: string;
  lastSeenAt: string | null;
};

const clientRow = z.object({
  id: col.uuid,
  kind: z.enum(["metadata_document", "registered", "preregistered", "app"]),
  client_id: col.text,
  name: col.text,
  logo_url: col.textOrNull,
  client_uri: col.textOrNull,
  redirect_uris: z.array(z.string()),
  application_type: z.enum(["web", "native"]).nullable(),
  verified: col.bool,
  blocked: col.bool,
  confidential: col.bool,
  fresh: col.bool,
  created_at: col.timestamp,
  last_seen_at: col.timestampOrNull,
});

const CLIENT_COLUMNS = sql`id, kind, client_id, name, logo_url, client_uri, redirect_uris, application_type, verified, blocked_at is not null as blocked,
  secret_hash is not null as confidential, coalesce(fresh_until > now(), false) as fresh, created_at, last_seen_at`;

function toClient(row: z.output<typeof clientRow>): OAuthClient {
  return {
    id: row.id,
    kind: row.kind,
    clientId: row.client_id,
    // Shown and passed on only as `safeClientName()` leaves it, whoever wrote the row (D439 review).
    name: safeClientName(row.name),
    logoUrl: row.logo_url,
    clientUri: row.client_uri,
    redirectUris: row.redirect_uris,
    applicationType: row.application_type,
    verified: row.verified,
    blocked: row.blocked,
    confidential: row.confidential,
    host: clientHost({ clientId: row.client_id, clientUri: row.client_uri, redirectUris: row.redirect_uris }),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Ends what outside assistants asked for and is still waiting for a yes (D439 review): the approvals kept through a grant that ended, a
 * store cut off from one, or a blocked client's. `where` narrows the approvals (`oauth_grant_id` …). Settling an autopilot step is not
 * needed: no step keeps an outside assistant's call.
 */
export async function expireGrantApprovals(executor: Executor, where: SQL): Promise<number> {
  const rows = await executor.execute(sql`
    update commerce.assistant_approvals set status = 'expired', decided_at = now(), result = ${JSON.stringify({ error: GRANT_ENDED_NOTE })}::jsonb
    where status = 'pending' and oauth_grant_id is not null and ${where}
    returning id
  `);
  return rows.length;
}

/** A list of text as a Postgres array, each item its own parameter. */
const textArray = (values: readonly string[]) => (values.length === 0 ? sql`'{}'::text[]` : sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`);

/** What fetches a metadata document: `safeFetch()`, or a test's stand-in at this boundary. */
export type MetadataFetch = (url: string, options: FetchOptions) => Promise<Fetched>;

/** The client a stored id names, as it is kept, whatever its freshness; null when there is none. */
export async function clientByClientId(clientId: string): Promise<OAuthClient | null> {
  const row = await typedRow(clientRow, sql`select ${CLIENT_COLUMNS} from commerce.oauth_clients where client_id = ${clientId}`);
  return row ? toClient(row) : null;
}

/** The client of a row id. */
export async function clientById(id: string): Promise<OAuthClient | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(clientRow, sql`select ${CLIENT_COLUMNS} from commerce.oauth_clients where id = ${id}::uuid`);
  return row ? toClient(row) : null;
}

export type FoundClient = { ok: true; client: OAuthClient } | { ok: false; problem: "unknown" | "blocked" | "document"; detail?: string };

/**
 * The client an authorization request names: a registered or made client as it is kept; a metadata document's client fetched again when
 * its document's time is up (or on first use) and kept as checked. A document that cannot be fetched or does not pass is refused, as is a
 * blocked client, whatever it says.
 */
export async function findClient(clientId: string, fetcher: MetadataFetch = safeFetch, mayFetch: () => Promise<boolean> = async () => true): Promise<FoundClient> {
  const kept = await typedRow(clientRow, sql`select ${CLIENT_COLUMNS} from commerce.oauth_clients where client_id = ${clientId}`);
  if (kept?.blocked) return { ok: false, problem: "blocked" };
  if (kept && kept.kind !== "metadata_document") return { ok: true, client: toClient(kept) };
  if (!isMetadataClientId(clientId)) return { ok: false, problem: "unknown" };
  if (kept?.fresh) return { ok: true, client: toClient(kept) };
  // A visitor names the address the server fetches: counted per address before any fetch (`oauth_fetch`).
  if (!(await mayFetch())) return { ok: false, problem: "document", detail: "Too many app descriptions fetched from this address: try later." };
  const read = await fetchMetadataDocument(clientId, fetcher);
  if (!read.ok) return { ok: false, problem: "document", detail: read.problem };
  const row = await typedRow(
    clientRow,
    sql`
      insert into commerce.oauth_clients (kind, client_id, name, logo_url, client_uri, redirect_uris, fetched_at, fresh_until)
      values ('metadata_document', ${clientId}, ${read.client.name}, ${read.client.logoUri}, ${read.client.clientUri},
        ${textArray(read.client.redirectUris)}, now(), now() + make_interval(secs => ${read.lifetime}))
      on conflict (client_id) do update set name = excluded.name, logo_url = excluded.logo_url, client_uri = excluded.client_uri,
        redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at, fresh_until = excluded.fresh_until,
        -- A platform admin verified who it was: a document that now names another app or sends codes elsewhere is checked again (D439 review).
        verified = commerce.oauth_clients.verified and commerce.oauth_clients.name = excluded.name
          and commerce.oauth_clients.redirect_uris = excluded.redirect_uris
      where commerce.oauth_clients.kind = 'metadata_document'
      returning ${CLIENT_COLUMNS}
    `,
  );
  if (!row) return { ok: false, problem: "unknown" };
  if (row.blocked) return { ok: false, problem: "blocked" };
  return { ok: true, client: toClient(row) };
}

/**
 * A metadata document fetched and checked: never through anything but `safeFetch()`'s rules, never following a redirect, and within one
 * overall deadline (`METADATA_TIMEOUT_MS`), not only an idle socket's: a server that drips its answer is cut off (D439 review).
 */
async function fetchMetadataDocument(url: string, fetcher: MetadataFetch) {
  const signal = AbortSignal.timeout(METADATA_TIMEOUT_MS);
  const late = new Promise<Fetched>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, problem: "The site took too long to answer." }), { once: true }));
  const fetched = await Promise.race([
    fetcher(url, { maxBytes: METADATA_MAX_BYTES, timeoutMs: METADATA_TIMEOUT_MS, accept: "application/json", maxRedirects: 0, signal }).catch(
      (): Fetched => ({ ok: false, problem: "The site could not be reached." }),
    ),
    late,
  ]);
  if (!fetched.ok) return { ok: false as const, problem: fetched.problem };
  if (fetched.contentType !== "application/json" && !fetched.contentType.endsWith("+json")) return { ok: false as const, problem: "The document is not JSON." };
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(fetched.bytes));
  } catch {
    return { ok: false as const, problem: "The document is not JSON." };
  }
  const read = readClientMetadata(document, url);
  if (!read.ok) return read;
  const cacheControl = fetched.headers?.["cache-control"];
  return { ok: true as const, client: read.client, lifetime: metadataLifetime(Array.isArray(cacheControl) ? cacheControl.join(",") : cacheControl) };
}

/** Writes down that a client was used, at most once a minute. */
export async function markClientSeen(id: string): Promise<void> {
  await db().execute(sql`
    update commerce.oauth_clients set last_seen_at = now()
    where id = ${id}::uuid and (last_seen_at is null or last_seen_at < now() - interval '1 minute')
  `);
}

/** A client secret's hash (SHA-256, hex): what is kept of an app's secret. */
export const secretHash = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/** Whether a secret is a confidential client's, compared in constant time; never for a public client. */
export async function clientSecretMatches(id: string, secret: string): Promise<boolean> {
  const row = await typedRow(z.object({ secret_hash: col.textOrNull }), sql`select secret_hash from commerce.oauth_clients where id = ${id}::uuid`);
  if (!row?.secret_hash || secret.length === 0 || secret.length > 500) return false;
  const given = Buffer.from(secretHash(secret), "hex");
  const kept = Buffer.from(row.secret_hash, "hex");
  return given.length === kept.length && timingSafeEqual(given, kept);
}

// Registration (RFC 7591) ------------------------------------------------------------------------------------------------------------

export type Registration =
  | { ok: true; response: Record<string, unknown> }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; problem: string };

/**
 * A client registering itself (RFC 7591), kept for MCP clients that do not publish a metadata document: public only (no secret is ever
 * issued), its redirect URIs HTTPS or loopback by its `application_type`, its id generated. The route counts registrations per address
 * (`takeBudget("oauth_register")`) before this runs.
 */
export async function registerClient(body: unknown): Promise<Registration> {
  const read = readRegistration(body);
  if (!read.ok) return read;
  const clientId = randomUUID();
  const row = await typedRow(
    z.object({ created_at: col.timestamp }),
    sql`
      insert into commerce.oauth_clients (kind, client_id, name, logo_url, client_uri, redirect_uris, application_type)
      values ('registered', ${clientId}, ${read.client.name}, ${read.client.logoUri}, ${read.client.clientUri}, ${textArray(read.client.redirectUris)},
        ${read.client.applicationType})
      returning created_at
    `,
  );
  log("info", "oauth.client_registered", { redirects: read.client.redirectUris.length });
  return {
    ok: true,
    response: {
      client_id: clientId,
      client_id_issued_at: Math.floor(new Date(row?.created_at ?? Date.now()).getTime() / 1000),
      client_name: read.client.name,
      redirect_uris: read.client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(read.client.applicationType && { application_type: read.client.applicationType }),
      ...(read.client.logoUri && { logo_uri: read.client.logoUri }),
      ...(read.client.clientUri && { client_uri: read.client.clientUri }),
    },
  };
}

// The platform's page (B7) -----------------------------------------------------------------------------------------------------------

export type ClientSeen = OAuthClient & { grants: number; people: number };

/** The clients seen, most recently used first, with how many live grants and people each has. */
export async function clientsSeen(limit = 200): Promise<ClientSeen[]> {
  const rows = await typedRows(
    clientRow.extend({ grants: col.int, people: col.int }),
    sql`
      select ${CLIENT_COLUMNS},
        (select count(*)::int from commerce.oauth_grants g where g.client_id = c.id and g.revoked_at is null) as grants,
        (select count(distinct g.account_id)::int from commerce.oauth_grants g where g.client_id = c.id and g.revoked_at is null) as people
      from commerce.oauth_clients c
      order by coalesce(c.last_seen_at, c.created_at) desc, c.id
      limit ${limit}
    `,
  );
  return rows.map((row) => ({ ...toClient(row), grants: row.grants, people: row.people }));
}

/** A platform admin marks a client as checked (or takes the mark back): the consent screen then shows it without *Not verified*. */
export async function setClientVerified(admin: Account, id: string, verified: boolean): Promise<boolean> {
  if (!admin.platformAdmin || !z.uuid().safeParse(id).success) return false;
  const rows = await db().execute(sql`update commerce.oauth_clients set verified = ${verified} where id = ${id}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(admin.id, null, verified ? "platform.oauth_client_verified" : "platform.oauth_client_unverified", {}, { target: { type: "oauth_client", id } });
  return true;
}

/**
 * A platform admin blocks a client (or lets it in again): blocked, it can ask nobody, its tokens are refused at once, and its live grants
 * end, so letting it in again brings none back.
 */
export async function setClientBlocked(admin: Account, id: string, blocked: boolean): Promise<boolean> {
  if (!admin.platformAdmin || !z.uuid().safeParse(id).success) return false;
  const ended = await db().transaction(async (tx) => {
    const rows = await tx.execute(sql`
      update commerce.oauth_clients set blocked_at = ${blocked ? sql`coalesce(blocked_at, now())` : sql`null`} where id = ${id}::uuid returning id
    `);
    if (rows.length === 0) return null;
    if (!blocked) return 0;
    const grants = await tx.execute(sql`update commerce.oauth_grants set revoked_at = now() where client_id = ${id}::uuid and revoked_at is null returning id`);
    await tx.execute(sql`
      update commerce.oauth_tokens set revoked_at = now()
      where revoked_at is null and grant_id in (select g.id from commerce.oauth_grants g where g.client_id = ${id}::uuid)
    `);
    // What it asked for and still waits for a yes ends with it (D439 review).
    await expireGrantApprovals(tx, sql`oauth_grant_id in (select g.id from commerce.oauth_grants g where g.client_id = ${id}::uuid)`);
    return grants.length;
  });
  if (ended === null) return false;
  await audit(admin.id, null, blocked ? "platform.oauth_client_blocked" : "platform.oauth_client_unblocked", blocked ? { grants_ended: ended } : {}, {
    target: { type: "oauth_client", id },
  });
  return true;
}
