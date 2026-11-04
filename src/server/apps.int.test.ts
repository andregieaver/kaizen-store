import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const SITE = "https://flow.example";
process.env.SITE_URL = SITE;
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { pkceChallenge } = await import("@/lib/oauth-pkce");
const { readAppForm } = await import("@/lib/apps");
const { addMember, auditRows, makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const oauth = await import("./oauth");
const { registerClient } = await import("./oauth-clients");
const { installable, installStores, readAuthorization } = await import("./oauth-authorize");
const apps = await import("./developer-apps");
const { POST: tokenRoute } = await import("@/app/api/oauth/token/route");
const adminRoute = await import("@/app/api/admin/v1/[...path]/route");
const { POST: mcpRoute } = await import("@/app/api/mcp/route");

type Row = Record<string, unknown>;

/**
 * Apps for many stores (wave 14 unit D, D441, D1): a developer makes an app (an OAuth client with a secret), a store's person installs it on
 * one store through the consent's checks, the app swaps the code with its secret for tokens that work on the Admin API and the owner MCP,
 * and each call does only what both the installation and the person's role allow now. Reinstalling or removing it ends its tokens.
 */

const REDIRECT = "https://app.example/oauth/callback";
let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let developer: Awaited<ReturnType<typeof makeAccount>>;

/** An app's form as `FormData` gives it. */
function formOf(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
}

beforeAll(async () => {
  store = await makeStore("apps");
  other = await makeStore("apps-other");
  developer = await makeAccount("Developer");
  // The developer works in `store` (so a private app may go there), not in `other`.
  await addMember(store.id, developer.id, "admin");
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.oauth_clients where name like ${"Apps test%"}`);
  await closeDb();
});

async function makeApp(scopes: string[], distribution = "unlisted") {
  const read = readAppForm(formOf({ name: `Apps test ${randomBytes(3).toString("hex")}`, redirect_uris: REDIRECT, scopes, distribution, description: "Syncs stock." }));
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  const made = await apps.createApp(developer, read.app);
  if (!made.ok) throw new Error(JSON.stringify(made.problems));
  return { id: made.id, clientId: made.shown.clientId, secret: made.shown.secret!, webhookSecret: made.shown.webhookSecret! };
}

const verifierOf = () => randomBytes(40).toString("base64url");

/** The consent as the install screen reads it and its action approves it, for one store; the code and its verifier. */
async function install(app: { clientId: string }, person: { id: string; email: string; name: string | null; platformAdmin: boolean }, storeId: string) {
  const verifier = verifierOf();
  const found = await readAuthorization({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: REDIRECT,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    state: "st",
    resource: `${SITE}/api/admin/v1`,
  });
  if (found.kind !== "ok") throw new Error(`not ok: ${JSON.stringify(found)}`);
  const view = (await apps.appOfClient(found.client.id))!;
  const chosen = (await installStores(person, "aal1", view)).find((s) => s.id === storeId);
  if (!chosen || !installable(chosen)) throw new Error(`not installable: ${JSON.stringify(chosen)}`);
  const { code, grantId } = await oauth.approveInstallation({ account: person, aal: "aal1", client: found.client, request: found.request, storeId, scopes: view.scopes });
  return { code, verifier, grantId };
}

/** The token endpoint as an app calls it: its client ID and secret by HTTP Basic. */
async function exchange(app: { clientId: string; secret: string }, code: string, verifier: string) {
  const response = await tokenRoute(
    new Request(`${SITE}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${app.clientId}:${app.secret}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT }).toString(),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

async function api(method: "GET" | "POST", path: string, token: string, body?: unknown, extra: Record<string, string> = {}) {
  const url = new URL(`${SITE}/api/admin/v1/${path}`);
  const response = await adminRoute[method](
    new Request(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra }, ...(body !== undefined && { body: JSON.stringify(body) }) }),
    { params: Promise.resolve({ path: path.split("/").filter(Boolean) }) } as never,
  );
  return { status: response.status, body: (await response.json()) as { error?: { code: string; message: string } }, headers: response.headers };
}

describe("an app for many stores (D441)", () => {
  it("asks for developer mode first, then makes an app whose secret is kept as a hash and shown once", async () => {
    const read = readAppForm(formOf({ name: "Apps test early", redirect_uris: REDIRECT, scopes: ["products:read"] }));
    if (!read.ok) throw new Error("form");
    expect(await apps.createApp(developer, read.app)).toEqual({ ok: false, problems: { form: "Turn on developer mode first." } });
    await apps.becomeDeveloper(developer);
    expect((await apps.developerOf(developer.id))?.termsVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const app = await makeApp(["products:read"]);
    expect(app.clientId).toMatch(/^kfapp_[A-Za-z0-9_-]{22}$/);
    expect(app.secret).toMatch(/^kfas_[A-Za-z0-9_-]{43}$/);
    const [client] = await db().execute<Row>(sql`select kind, secret_hash from commerce.oauth_clients where client_id = ${app.clientId}`);
    expect(client.kind).toBe("app");
    expect(String(client.secret_hash)).not.toContain(app.secret);
    const [row] = await db().execute<Row>(sql`select webhook_secret_encrypted from commerce.apps where id = ${app.id}::uuid`);
    expect(String(row.webhook_secret_encrypted)).not.toContain(app.webhookSecret);
    expect((await apps.appsOf(developer.id)).map((a) => a.id)).toContain(app.id);
    expect(await apps.ownApp((await makeAccount("Someone")).id, app.id)).toBeNull();
  });

  it("is installed on one store through the consent's checks, and its tokens work on the Admin API as far as both its scopes and the person's role allow", async () => {
    const app = await makeApp(["products:read", "orders:read"]);
    const { code, verifier, grantId } = await install(app, store.account, store.id);
    // A wrong secret is refused; the right one gets the tokens.
    expect((await exchange({ ...app, secret: `${app.secret.slice(0, -1)}x` }, code, verifier)).status).toBe(401);
    const tokens = await exchange(app, code, verifier);
    expect(tokens.status).toBe(200);
    expect(tokens.body.access_token).toMatch(/^kfa_/);
    const token = tokens.body.access_token;

    expect((await api("GET", "products", token)).status).toBe(200);
    expect((await api("GET", "orders", token)).status).toBe(200);
    // Making a product needs products:write, which the installation does not hold, though its person (the owner) may.
    const refused = await api("POST", "products", token, { title: "App shirt", prices: { NO: "499" } });
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toContain("products:write");
    // Every call is the person's: the audit names the app, the installation is listed on the store.
    const reaching = await oauth.grantsReachingStore(store.id);
    expect(reaching.find((g) => g.id === grantId)?.resource).toBe("admin");
    expect((await auditRows(store.id, "oauth.app_installed")).length).toBeGreaterThan(0);
  });

  it("does what the installation holds, keeps its Idempotency-Key per installation, and stops at the person's role", async () => {
    const app = await makeApp(["products:write"]);
    const person = await makeAccount("Staff");
    await addMember(store.id, person.id, "owner");
    const { code, verifier } = await install(app, person, store.id);
    const token = (await exchange(app, code, verifier)).body.access_token;
    const made = await api("POST", "products", token, { title: "App shirt", prices: { NO: "499" } }, { "idempotency-key": "app-shirt-1" });
    expect(made.status).toBe(201);
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.api_app_idempotency_keys where key = 'app-shirt-1'`);
    expect(Number(kept.n)).toBe(1);
    const again = await api("POST", "products", token, { title: "App shirt", prices: { NO: "499" } }, { "idempotency-key": "app-shirt-1" });
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    // The person loses the store: the installation's token no longer reaches it.
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${person.id}::uuid`);
    expect((await api("GET", "products", token)).status).toBe(401);
  });

  it("offers a store only where the person may give everything the app asks for, and a private app only on its developer's stores", async () => {
    const app = await makeApp(["products:read", "products:publish"], "private");
    const view = (await apps.appOfClient((await db().execute<Row>(sql`select client_id from commerce.apps where id = ${app.id}::uuid`))[0].client_id as string))!;
    const [owners, others] = [await installStores(store.account, "aal1", view), await installStores(other.account, "aal1", view)];
    expect(owners.find((s) => s.id === store.id)).toMatchObject({ missing: [], notDevelopers: false });
    expect(others.find((s) => s.id === other.id)).toMatchObject({ notDevelopers: true });
    expect(installable(others.find((s) => s.id === other.id)!)).toBe(false);
  });

  it("asks only an app for the Admin API, and an app only for it", async () => {
    const app = await makeApp(["products:read"]);
    const verifier = verifierOf();
    const base = { response_type: "code", redirect_uri: REDIRECT, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", state: "st" };
    const forMcp = await readAuthorization({ ...base, client_id: app.clientId, resource: `${SITE}/api/mcp` });
    expect(forMcp.kind).toBe("redirect");
    expect(forMcp.kind === "redirect" && new URL(forMcp.to).searchParams.get("error")).toBe("invalid_target");
    const registered = await registerClient({ client_name: "Apps test registered", redirect_uris: [REDIRECT] });
    if (!registered.ok) throw new Error("registration");
    const forAdmin = await readAuthorization({ ...base, client_id: String(registered.response.client_id), resource: `${SITE}/api/admin/v1` });
    expect(forAdmin.kind).toBe("show");
  });

  it("takes the installation's token on the owner MCP too, and an assistant's MCP token never on the Admin API", async () => {
    const app = await makeApp(["products:read"]);
    const { code, verifier } = await install(app, store.account, store.id);
    const token = (await exchange(app, code, verifier)).body.access_token;
    const listed = await mcpRoute(
      new Request(`${SITE}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(listed.status).toBe(200);
    const tools = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(tools).toContain("list_stores");
    expect(tools.some((t) => t.startsWith("update_product"))).toBe(false);
    // A grant for the MCP alone (an AI assistant's) is not taken by the Admin API.
    const assistant = await registerClient({ client_name: "Apps test assistant", redirect_uris: [REDIRECT] });
    if (!assistant.ok) throw new Error("registration");
    const assistantId = String(assistant.response.client_id);
    const v = verifierOf();
    const found = await readAuthorization({ response_type: "code", client_id: assistantId, redirect_uri: REDIRECT, code_challenge: pkceChallenge(v), code_challenge_method: "S256", state: "s", resource: `${SITE}/api/mcp` });
    if (found.kind !== "ok") throw new Error("assistant");
    const { code: c } = await oauth.approveAuthorization({ account: store.account, aal: "aal1", client: found.client, request: found.request, storeIds: [store.id], scopes: ["stores:read", "products:read"], access: "read" });
    const swapped = await oauth.tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code: c, code_verifier: v, client_id: assistantId, redirect_uri: REDIRECT }), null);
    if (!swapped.ok) throw new Error(swapped.error);
    expect((await api("GET", "products", swapped.body.access_token)).status).toBe(401);
  });

  it("ends the tokens of an installation made again or removed by an owner", async () => {
    const app = await makeApp(["products:read"]);
    const first = await install(app, store.account, store.id);
    const old = (await exchange(app, first.code, first.verifier)).body.access_token;
    const second = await install(app, store.account, store.id);
    const fresh = (await exchange(app, second.code, second.verifier)).body.access_token;
    expect((await api("GET", "products", old)).status).toBe(401);
    expect((await api("GET", "products", fresh)).status).toBe(200);
    // A staff member may not remove it; an owner may.
    const staff = await makeAccount("Staff remover");
    await addMember(store.id, staff.id, "admin");
    expect(await oauth.removeInstallation(await membershipOf(store.slug, staff, "admin"), second.grantId)).toBe(false);
    expect(await oauth.removeInstallation(await membershipOf(store.slug, store.account), second.grantId)).toBe(true);
    expect((await api("GET", "products", fresh)).status).toBe(401);
    expect((await auditRows(store.id, "oauth.app_removed")).length).toBeGreaterThan(0);
  });
});
