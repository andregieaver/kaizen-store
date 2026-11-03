import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * Kaizena Flow's consent screen as the owner meets it (wave 14 unit B, D439, B8): an MCP client registers, sends the owner to
 * `/oauth/authorize`, and the admin's own frame shows the client, its host and *Not verified by Kaizena Flow*, the owner's store ticked,
 * *Read and propose changes* chosen, and *Choose permissions* one step away. Allow sends a code, the state and the issuer back to the
 * client's loopback address (answered here by the test, never a real server), the code buys a token that reads through the MCP and is
 * refused a change it was not given; Cancel sends `access_denied`; the page is never framed; Disconnect ends the token; the store's Apps
 * and API page lists the connection, cuts it off and lets it in again; the platform admin sees the client with Verify and Block; and a
 * wrong request from a registered client is said on the page, never forwarded (D439 review).
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const PORT = 43219;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
let clientId = "";

const verifierOf = () => randomBytes(40).toString("base64url");
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** The client's loopback listener, played by the test: it answers whatever arrives there. */
async function listen(page: Page) {
  await page.route(`http://127.0.0.1:${PORT}/**`, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "back at the app" }));
}

function authorizeUrl(baseURL: string, verifier: string, state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challengeOf(verifier),
    code_challenge_method: "S256",
    state,
    resource: `${new URL(baseURL).origin}/api/mcp`,
    scope: "stores:read orders:read",
  });
  return `/oauth/authorize?${params}`;
}

test("an MCP client registers itself as a public client", async ({ request }) => {
  const answer = await request.post("/api/oauth/register", {
    data: { client_name: "E2E Assistant", client_uri: "https://e2e-assistant.example", redirect_uris: ["http://127.0.0.1/callback"], token_endpoint_auth_method: "none" },
  });
  expect(answer.status()).toBe(201);
  const body = await answer.json();
  expect(body).toMatchObject({ client_name: "E2E Assistant", token_endpoint_auth_method: "none" });
  expect(body).not.toHaveProperty("client_secret");
  clientId = body.client_id;
});

test("the owner sees who asks and what it may do, chooses, allows, and the token reads through the MCP", async ({ page, baseURL }) => {
  await listen(page);
  const verifier = verifierOf();
  const response = await page.goto(authorizeUrl(baseURL!, verifier, "e2e-state-1"));
  expect(new URL(page.url()).pathname).toBe("/admin/oauth/authorize");
  // Never framed, by anyone (clickjacking).
  expect(response?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");

  await expect(page.getByRole("heading", { level: 1, name: "E2E Assistant wants to work with your stores" })).toBeVisible();
  // The host shown is where the code goes, not the site the registration only claims.
  await expect(page.getByText(`From 127.0.0.1:${PORT}`)).toBeVisible();
  await expect(page.getByText("e2e-assistant.example")).toHaveCount(0);
  await expect(page.getByText("Not verified by Kaizena Flow")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "E2E Shop" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Read and propose changes" })).toBeChecked();
  await expect(page.getByText("Nothing changes until you say yes in Kaizena Flow.")).toBeVisible();

  // Lisa's step: the permissions one by one, held to the level.
  await page.getByText("Choose permissions").click();
  await expect(page.getByRole("checkbox", { name: /Change orders/ })).toBeChecked();
  await page.getByRole("radio", { name: "Read only" }).check();
  await expect(page.getByText("It changes nothing.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Change orders/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /See orders/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /See customers/ }).uncheck();

  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL((url) => url.origin === `http://127.0.0.1:${PORT}`);
  const back = new URL(page.url());
  expect(back.pathname).toBe("/callback");
  expect(back.searchParams.get("state")).toBe("e2e-state-1");
  expect(back.searchParams.get("iss")).toBe(new URL(baseURL!).origin);
  const code = back.searchParams.get("code") ?? "";
  expect(code).toMatch(/^kfc_/);

  const token = await page.request.post("/api/oauth/token", {
    form: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: back.origin + back.pathname },
  });
  expect(token.status()).toBe(200);
  const tokens = await token.json();
  expect(tokens.scope.split(" ")).toContain("orders:read");
  expect(tokens.scope.split(" ")).not.toContain("customers:read");
  expect(tokens.scope.split(" ")).not.toContain("orders:write");

  const call = (body: unknown) => page.request.post("/api/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` }, data: body });
  const listed = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_stores", arguments: {} } });
  expect(listed.status()).toBe(200);
  expect(JSON.parse((await listed.json()).result.content[0].text).stores.map((s: { slug: string }) => s.slug)).toContain(E2E_STORE);
  const refused = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "archive_product", arguments: { store: E2E_STORE, product: "x" } } });
  expect(refused.status()).toBe(403);
  expect(refused.headers()["www-authenticate"]).toContain('scope="products:write"');

  // Your account → Connected apps and assistants: Disconnect ends it at once.
  await page.goto("/admin/account/connected");
  await expect(page.getByText("E2E Assistant").first()).toBeVisible();
  await expect(page.getByText("Access: Read only").first()).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).first().click();
  await expect.poll(async () => (await call({ jsonrpc: "2.0", id: 3, method: "ping" })).status(), { timeout: 15_000 }).toBe(401);
});

test("Cancel sends the client access_denied with its state", async ({ page, baseURL }) => {
  await listen(page);
  await page.goto(authorizeUrl(baseURL!, verifierOf(), "e2e-state-2"));
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL((url) => url.origin === `http://127.0.0.1:${PORT}`);
  const back = new URL(page.url());
  expect([back.searchParams.get("error"), back.searchParams.get("state"), back.searchParams.get("code")]).toEqual(["access_denied", "e2e-state-2", null]);
});

test("a request whose redirect URI the client never registered is shown, never sent anywhere", async ({ page, baseURL }) => {
  const url = authorizeUrl(baseURL!, verifierOf(), "e2e-state-3").replace(encodeURIComponent(REDIRECT), encodeURIComponent("https://evil.example/callback"));
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "This request cannot be used" })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
});

test("a wrong request from a client nobody vouched for is said here, never forwarded to its address (D439 review)", async ({ page, baseURL }) => {
  await listen(page);
  const url = authorizeUrl(baseURL!, verifierOf(), "e2e-state-5").replace("response_type=code&", "");
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "This request cannot be used" })).toBeVisible();
  await expect(page.getByText("you were not sent back to it")).toBeVisible();
  await expect(page.getByRole("link", { name: `http://127.0.0.1:${PORT}` })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
});

test("the store's Apps and API page lists what reaches the store, and the owner can cut it off", async ({ page, baseURL }) => {
  await listen(page);
  await page.goto(authorizeUrl(baseURL!, verifierOf(), "e2e-state-4"));
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL((url) => url.origin === `http://127.0.0.1:${PORT}`);
  await page.goto(`/admin/${E2E_STORE}/settings/api`);
  const card = page.getByRole("region", { name: "AI assistants and apps connected to this store" });
  await expect(card.getByText("E2E Assistant")).toBeVisible();
  await expect(card.getByText(/Connected by Eva Owner/)).toBeVisible();
  await card.getByRole("button", { name: "Cut off" }).click();
  await expect(card.getByText("No AI assistant or app reaches this store.")).toBeVisible({ timeout: 15_000 });
  // The cut stays until an owner lets it in again (D439 review).
  const cut = page.getByRole("region", { name: "Cut off from this store" });
  await expect(cut.getByText("E2E Assistant")).toBeVisible();
  await cut.getByRole("button", { name: "Let in again" }).click();
  await expect(page.getByRole("region", { name: "Cut off from this store" })).toHaveCount(0, { timeout: 15_000 });
});

test.describe("the platform's list of clients", () => {
  test.use({ storageState: ADMIN.state });

  test("shows each client with Verify and Block", async ({ page }) => {
    await page.goto("/admin/platform/oauth");
    await expect(page.getByRole("heading", { level: 1, name: "AI assistants and apps" })).toBeVisible();
    await expect(page.getByText("E2E Assistant").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Block" }).first()).toBeVisible();
  });
});
