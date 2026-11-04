import "server-only";

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";

import {
  readAuthorizeRequest,
  readClientParams,
  redirectMatches,
  redirectWith,
  resourceUrl,
  STATE_MAX,
  type AuthorizeRequest,
} from "@/lib/oauth";
import { missingPermissions } from "@/lib/apps";
import { permissionsOf, type PermissionKey } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";

import { holderOf, listStores, passMembership, type Account } from "./auth";
import { cutStoreIds } from "./oauth";
import { findClient, type MetadataFetch, type OAuthClient } from "./oauth-clients";
import { safeFetch } from "./replicate-fetch";
import { budgetVisitor, takeBudget } from "./request-budget";
import { col, typedRows } from "./typed-rows";

/**
 * Reading an authorization request (D439, B4) for the consent page and its action alike: the client and its redirect URI first (a refusal
 * before they are known is shown on the page, never sent anywhere: no open redirect), then the rest (a refusal is sent back to the
 * client's own redirect URI with `state` and `iss`, RFC 6749 4.1.2.1, RFC 9207). And the stores a person may connect.
 */

/** The parameters an authorization request carries, as the consent form hands them back. */
export const AUTHORIZE_PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource", "scope"] as const;

export type Authorization =
  | { kind: "show"; reason: "client" | "redirect_uri" | "repeated" | "blocked" | "document" }
  /** A request that is wrong from a client Kaizena Flow does not vouch for: said here, with a plain link to where it came from. */
  | { kind: "show"; reason: "request"; description: string; origin: string }
  | { kind: "redirect"; to: string }
  | { kind: "ok"; client: OAuthClient; request: AuthorizeRequest };

/**
 * Whether a wrong request is sent back to the client's redirect URI (D439 review, RFC 9700 4.11.2): only for a client Kaizena Flow
 * vouches for, one a platform admin verified or one it made itself. Anyone can register a client, or publish a metadata document, with any
 * address, so for those a wrong request is said on our page: forwarding it would make the authorization endpoint an open redirector. Once a
 * person has decided, their answer goes back to any client.
 */
export const sendsErrorsBack = (client: Pick<OAuthClient, "verified" | "kind">): boolean => client.verified || client.kind === "preregistered" || client.kind === "app";

type Query = Record<string, string | string[] | undefined>;

/** Whether the request's address may have one more metadata document fetched this hour (`oauth_fetch`, failing closed). */
export async function documentFetchAllowed(): Promise<boolean> {
  return takeBudget(null, "oauth_fetch", budgetVisitor(await headers()));
}

/**
 * The request read and checked against its client: a metadata document fetched through `safeFetch()` when it is not kept or its time is
 * up, only while the visitor's address has fetches left (`documentFetchAllowed()`; tests pass their own stand-ins for both).
 */
export async function readAuthorization(query: Query, fetcher: MetadataFetch = safeFetch, mayFetch: () => Promise<boolean> = documentFetchAllowed): Promise<Authorization> {
  const params = readClientParams(query);
  if (!params.ok) return { kind: "show", reason: "show" in params.refusal ? params.refusal.show : "client" };
  const found = await findClient(params.clientId, fetcher, mayFetch);
  if (!found.ok) return { kind: "show", reason: found.problem === "unknown" ? "client" : found.problem };
  // Exactly a redirect URI the client registered (a loopback one on any port): else nothing is sent anywhere.
  if (!redirectMatches(found.client.redirectUris, params.redirectUri)) return { kind: "show", reason: "redirect_uri" };
  const read = readAuthorizeRequest(query, siteUrl(), params);
  if (!read.ok) {
    if ("show" in read.refusal) return { kind: "show", reason: read.refusal.show };
    if (!sendsErrorsBack(found.client)) return { kind: "show", reason: "request", description: read.refusal.description, origin: new URL(params.redirectUri).origin };
    const state = typeof query.state === "string" && query.state.length <= STATE_MAX ? query.state : null;
    return { kind: "redirect", to: redirectWith(params.redirectUri, { error: read.refusal.redirect, error_description: read.refusal.description, state, iss: siteUrl() }) };
  }
  // An app is installed on the Admin API (D441), and only an app is: anything else's request for it, or an app's for the MCP, is refused.
  const isApp = found.client.kind === "app";
  if (isApp !== (read.request.resource === "admin")) {
    const description = isApp ? `An app asks for resource=${resourceUrl(siteUrl(), "admin")}.` : `resource must be ${resourceUrl(siteUrl(), "mcp")}.`;
    if (!sendsErrorsBack(found.client)) return { kind: "show", reason: "request", description, origin: new URL(params.redirectUri).origin };
    const state = typeof query.state === "string" && query.state.length <= STATE_MAX ? query.state : null;
    return { kind: "redirect", to: redirectWith(params.redirectUri, { error: "invalid_target", error_description: description, state, iss: siteUrl() }) };
  }
  return { kind: "ok", client: found.client, request: read.request };
}

/** The request's parameters as a query string, to come back to the page after signing in or a refusal of the form. */
export function authorizeQuery(query: Query): string {
  const params = new URLSearchParams();
  for (const key of AUTHORIZE_PARAMS) {
    const value = query[key];
    if (typeof value === "string") params.set(key, value);
  }
  return params.toString();
}

export type ConsentStore = {
  id: string;
  slug: string;
  name: string;
  /** The person's keys there now. */
  held: PermissionKey[];
  /** The store requires two-step and the session has not passed it: shown, not offered. */
  needsTwoStep: boolean;
  /** The store's owner cut this client off for this person (`oauth_store_cutoffs`): shown, not offered, until an owner lets it in again. */
  cutOff: boolean;
};

/** Whether a store on the consent screen can be ticked: neither held at the second step nor cut off. */
export const connectable = (store: ConsentStore): boolean => !store.needsTwoStep && !store.cutOff;

/**
 * The stores a person may connect: those they work in now where their role holds anything at all (ticked by default), each with what
 * they hold. A store that requires two-step is offered only to a session at `aal2`, as its admin is; a store whose owner cut the client off
 * for this person is not offered either (D439 review).
 */
export async function consentStores(account: Account, aal: "aal1" | "aal2", clientRowId?: string): Promise<ConsentStore[]> {
  const stores = await listStores(account);
  if (stores.length === 0) return [];
  const cut = new Set(clientRowId ? await cutStoreIds(account.id, clientRowId) : []);
  const flags = await typedRows(
    z.object({ slug: col.text, require_two_step: col.bool }),
    sql`select slug, require_two_step from commerce.stores where slug = any(${sql`array[${sql.join(stores.map((s) => sql`${s.slug}`), sql`, `)}]::text[]`})`,
  );
  const needs = new Set(flags.filter((f) => f.require_two_step).map((f) => f.slug));
  const read = await Promise.all(
    stores.map(async (s) => {
      const member = await passMembership(s.slug, account.id);
      if (!member) return null;
      const held = permissionsOf(holderOf(member));
      return held.length > 0
        ? { id: member.store.id, slug: s.slug, name: s.name, held, needsTwoStep: needs.has(s.slug) && aal !== "aal2", cutOff: cut.has(member.store.id) }
        : null;
    }),
  );
  return read.filter((s): s is ConsentStore => s !== null);
}

/** Every key a person holds across some stores: what a level's scopes are drawn from. */
export const heldAcross = (stores: readonly ConsentStore[]): PermissionKey[] => [...new Set(stores.flatMap((s) => s.held))];

/** A store offered for an app's installation (D441): what the consent screen says of each, and whether it can be chosen. */
export type InstallStore = ConsentStore & {
  /** What the app asks for that the person's role there cannot give. */
  missing: PermissionKey[];
  /** A private app goes only on its developer's own stores. */
  notDevelopers: boolean;
};

/** Whether a store can be chosen for an app: not held at the second step, the person may give all the app asks for, and, for a private app, it is the developer's. */
export const installable = (store: InstallStore): boolean => !store.needsTwoStep && store.missing.length === 0 && !store.notDevelopers;

/**
 * The stores a person may install an app on (D441): those they work in where their role holds anything, each saying what the app asks
 * for that their role there cannot give, and, for a private app, whether it is one of the developer's own stores.
 */
export async function installStores(account: Account, aal: "aal1" | "aal2", app: { scopes: readonly string[]; distribution: string; developerId: string | null }): Promise<InstallStore[]> {
  const stores = await consentStores(account, aal);
  let developers: Set<string> | null = null;
  if (app.distribution === "private") {
    const rows = app.developerId
      ? await typedRows(
          z.object({ store_id: col.uuid }),
          sql`select store_id from commerce.store_members where account_id = ${app.developerId}::uuid and disabled_at is null and (expires_at is null or expires_at > now())`,
        )
      : [];
    developers = new Set(rows.map((r) => r.store_id));
  }
  return stores.map((store) => ({
    ...store,
    cutOff: false,
    missing: missingPermissions(app.scopes, store.held),
    notDevelopers: developers !== null && !developers.has(store.id),
  }));
}

