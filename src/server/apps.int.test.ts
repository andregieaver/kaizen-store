import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const SITE = "https://flow.example";
process.env.SITE_URL = SITE;
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
// An app's events address is a made-up host, and its deliveries go to a server on this machine: the address guard lets tests do both only
// with this switch (ignored on Vercel). The services' own sends (Zapier, Make, Slack) of other tests' stores never leave this machine.
process.env.REPLICATE_ALLOW_PRIVATE = "1";
vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));

const { closeDb, db } = await import("@/db/client");
const { pkceChallenge } = await import("@/lib/oauth-pkce");
const { readAppForm } = await import("@/lib/apps");
const { addMember, auditRows, makeAccount, makeStore, membershipOf } = await import("./trust-fixtures");
const oauth = await import("./oauth");
const { registerClient } = await import("./oauth-clients");
const { installable, installStores, readAuthorization } = await import("./oauth-authorize");
const apps = await import("./developer-apps");
const endpoints = await import("./webhook-endpoints");
const integrations = await import("./integrations");
const { encryptSecret } = await import("@/lib/secret-box");
const { verifyWebhook, SIGNATURE_HEADER, TIMESTAMP_HEADER, TOPIC_HEADER } = await import("@/lib/webhook-signature");
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

describe("an app's events (D441 D2)", () => {
  const received: { topic: string; body: string; signature: string; timestamp: string }[] = [];
  const receiver = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ topic: String(request.headers[TOPIC_HEADER.toLowerCase()]), body, signature: String(request.headers[SIGNATURE_HEADER.toLowerCase()]), timestamp: String(request.headers[TIMESTAMP_HEADER.toLowerCase()]) });
      response.writeHead(200).end("ok");
    });
  });
  let localUrl = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    localUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/events`;
  });
  afterAll(() => receiver.close());

  /** An app with an events address and the topics it wants. */
  async function eventsApp(scopes: string[], topics: string[]) {
    const read = readAppForm(
      formOf({ name: `Apps test ${randomBytes(3).toString("hex")}`, redirect_uris: REDIRECT, scopes, distribution: "unlisted", webhook_url: "https://hooks.app.example/events", webhook_topics: topics }),
    );
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    const made = await apps.createApp(developer, read.app);
    if (!made.ok) throw new Error(JSON.stringify(made.problems));
    return { id: made.id, clientId: made.shown.clientId, secret: made.shown.secret!, webhookSecret: made.shown.webhookSecret!, read: read.app };
  }
  const endpointOf = async (grantId: string) =>
    (await db().execute<Row>(sql`select id, topics, enabled, disabled_reason, created_by from commerce.webhook_endpoints where app_grant_id = ${grantId}::uuid`))[0];
  const deliveries = async (endpointId: string) =>
    db().execute<Row>(sql`
      select event, status, last_error, subject_id, next_attempt_at > now() + interval '47 hours' as later
      from commerce.integration_deliveries where endpoint_id = ${endpointId}::uuid order by created_at, event
    `);

  it("gives each installation an endpoint of its own with the topics its scopes read, never the owner's to see", async () => {
    const app = await eventsApp(["products:read"], ["order.paid", "product.updated", "customer.updated"]);
    const { grantId } = await install(app, store.account, store.id);
    const endpoint = await endpointOf(grantId);
    expect(endpoint).toBeDefined();
    // order.paid and customer.updated need orders:read and customers:read, which it does not hold; customer.erased always goes.
    expect([...(endpoint.topics as string[])].sort()).toEqual(["customer.erased", "product.updated"]);
    expect(endpoint.created_by).toBe(store.account.id);
    expect((await endpoints.listEndpoints(store.id)).map((e) => e.id)).not.toContain(endpoint.id);
    const owner = await membershipOf(store.slug, store.account);
    expect(await endpoints.removeEndpoint(owner, String(endpoint.id))).toBe(false);
    expect(await endpoints.switchEndpoint(owner, String(endpoint.id), false)).toBe(false);
    expect((await endpointOf(grantId)).enabled).toBe(true);

    // The app's topics change: every installation's endpoint follows at once.
    const changed = await apps.updateApp(developer, app.id, { ...app.read, webhookUrl: null, webhookTopics: ["product.created", "order.paid"] });
    expect(changed.ok).toBe(true);
    expect([...((await endpointOf(grantId)).topics as string[])].sort()).toEqual(["customer.erased", "product.created"]);
  });

  it("keeps an installation's scopes until an owner gives it what its app asks for now, and only what its installer may give", async () => {
    const app = await eventsApp(["products:read"], ["order.paid", "product.updated"]);
    const { grantId } = await install(app, store.account, store.id);
    expect((await oauth.installationAsks(store)).has(grantId)).toBe(false);
    const grown = await apps.updateApp(developer, app.id, { ...app.read, scopes: [...app.read.scopes, "orders:read"], webhookUrl: null });
    expect(grown.ok).toBe(true);
    expect((await oauth.installationAsks(store)).get(grantId)).toEqual({ more: ["orders:read"], installerCan: true });
    // Not yet: the installation still holds only what it was given.
    expect([...((await endpointOf(grantId)).topics as string[])].sort()).toEqual(["customer.erased", "product.updated"]);
    const staff = await makeAccount("Staff approver");
    await addMember(store.id, staff.id, "admin");
    expect(await oauth.approveInstallationScopes(await membershipOf(store.slug, staff, "admin"), grantId)).toEqual({ ok: false, reason: "gone" });
    expect(await oauth.approveInstallationScopes(await membershipOf(store.slug, store.account), grantId)).toEqual({ ok: true, added: ["orders:read"] });
    expect((await oauth.installationAsks(store)).has(grantId)).toBe(false);
    expect([...((await endpointOf(grantId)).topics as string[])].sort()).toEqual(["customer.erased", "order.paid", "product.updated"]);
    expect((await auditRows(store.id, "oauth.app_scopes_approved")).length).toBeGreaterThan(0);
  });

  it("sends app.uninstalled at once and store.erase_requested 48 hours later to a removed app, nothing else, and neither once it is installed again", async () => {
    const app = await eventsApp(["products:read"], ["product.updated"]);
    const { grantId } = await install(app, store.account, store.id);
    const endpoint = await endpointOf(grantId);
    // The deliveries go to the server on this machine instead of the app's made-up host.
    await db().execute(sql`
      update commerce.webhook_endpoints set url_encrypted = ${encryptSecret(localUrl, Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64"))}
      where id = ${String(endpoint.id)}::uuid
    `);
    expect(await oauth.removeInstallation(await membershipOf(store.slug, store.account), grantId)).toBe(true);
    expect(await endpointOf(grantId)).toMatchObject({ enabled: false, disabled_reason: "uninstalled" });
    expect((await deliveries(String(endpoint.id))).map((d) => [d.event, d.status, d.later])).toEqual([
      ["app.uninstalled", "pending", false],
      ["store.erase_requested", "pending", true],
    ]);
    // A product saved now is not sent to it: its endpoint is off.
    await db().execute(sql`select commerce.queue_integration_event(${store.id}::uuid, 'product.updated', gen_random_uuid())`);
    expect((await deliveries(String(endpoint.id))).length).toBe(2);

    received.length = 0;
    await integrations.deliverDue(500);
    const sent = received.filter((r) => r.topic === "app.uninstalled");
    expect(sent).toHaveLength(1);
    expect(verifyWebhook({ secret: app.webhookSecret, signature: sent[0].signature, timestamp: sent[0].timestamp, body: sent[0].body })).toBe(true);
    const body = JSON.parse(sent[0].body) as { topic: string; data: { installation: { id: string; client_id: string; removed_at: string } } };
    expect(body.topic).toBe("app.uninstalled");
    expect(body.data.installation).toMatchObject({ id: grantId, client_id: app.clientId });
    expect(received.some((r) => r.topic === "store.erase_requested")).toBe(false);

    // Installed again within the 48 hours: the store's data is not to be erased after all.
    const again = await install(app, store.account, store.id);
    expect((await deliveries(String(endpoint.id))).find((d) => d.event === "store.erase_requested")).toMatchObject({ status: "failed", last_error: "Installed again" });
    expect(await endpointOf(again.grantId)).toMatchObject({ enabled: true, disabled_reason: null });
  });

  it("ends the installations of a person who leaves the store, and tells the app", async () => {
    const app = await eventsApp(["products:read"], ["product.updated"]);
    const leaver = await makeAccount("Leaver");
    await addMember(store.id, leaver.id, "owner");
    const { grantId } = await install(app, leaver, store.id);
    const endpoint = await endpointOf(grantId);
    await db().execute(sql`delete from commerce.store_members where store_id = ${store.id}::uuid and account_id = ${leaver.id}::uuid`);
    expect((await db().execute<Row>(sql`select revoked_at is not null as ended from commerce.oauth_grants where id = ${grantId}::uuid`))[0].ended).toBe(true);
    expect((await deliveries(String(endpoint.id))).map((d) => d.event)).toEqual(["app.uninstalled", "store.erase_requested"]);
  });
});
