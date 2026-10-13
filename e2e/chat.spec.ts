import { expect, test } from "@playwright/test";

import { encryptSecret, parseKey } from "../src/lib/secret-box";

import { testDb } from "./db";

/**
 * The chat agent (D81): a store with an agent and an AI shows the widget,
 * labelled as AI, with the agent's name, occupation and greeting; answers
 * show the store's product cards and open the page the agent opened; the
 * conversation is the site's (D216): the tab sends only the new message
 * with the conversation's reference, and keeps a copy to draw after a
 * reload. The model is not called here: the answers are the browser's
 * stand-ins for /api/chat (the agent is tested in src/server/chat.int.test.ts
 * and the conversations in src/server/support.int.test.ts).
 */
test("a store's chat agent answers, shows products and opens the page for the visitor", async ({ page, request }) => {
  const slug = `chat-${Date.now()}`;
  const sql = testDb();
  try {
    const [access] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Siris Butikk', null) as id`;

    // A store that is not there has no chat.
    const missing = await request.post("/api/chat", { data: { store: `${slug}-none`, market: "no", message: "Hei" } });
    expect(missing.status()).toBe(404);

    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await sql`
      insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, text_model)
      values (${storeId}, 'openai', ${encryptSecret("sk-test", key)}, '…test', 'text-model')`;
    await sql`
      insert into commerce.chat_agents (store_id, enabled, name, occupation, greeting)
      values (${storeId}, true, 'Ingrid', 'Kundeservice', ${sql.json({ "nb-NO": "Hei, jeg er Ingrid! Spør meg om lamper." })})`;

    // Requests from other sites are refused before anything else.
    const foreign = await request.post("/api/chat", {
      headers: { origin: "https://elsewhere.example" },
      data: { store: slug, market: "no", message: "Hei" },
    });
    expect(foreign.status()).toBe(403);
    const unreadable = await request.post("/api/chat", { data: { store: slug, market: "no", message: "" } });
    expect(unreadable.status()).toBe(400);
    // A conversation that is not the visitor's is not there.
    const stranger = await request.post("/api/chat/feed", {
      data: { store: slug, market: "no", conversation: { id: "6f1e4c2a-1b2c-4d3e-8f90-123456789abc", token: "x".repeat(32) }, after: 0 },
    });
    expect(stranger.status()).toBe(404);

    const ref = { id: "0b5c1d2e-3f40-4a51-8b62-7c83d94ea5f6", token: "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123" };
    const state = { status: "open", handler: "ai", mode: "off", agent: null, queue: null, available: true, emailLeft: 0, signedIn: false, emailFollowup: false };
    const at = "2026-10-13T12:00:00.000Z";

    const sent: Record<string, unknown>[] = [];
    const lamp = {
      handle: "demo-bordlampe",
      title: "Demo: Bordlampe",
      href: `/s/${slug}/no/p/demo-bordlampe`,
      image: null,
      price: { amountMinor: 49900, currency: "NOK", referenceMinor: null, vat: { rate: 0.25, shown: "incl" }, measure: null },
      from: false,
    };
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      sent.push(body);
      const first = sent.length === 1;
      await route.fulfill({
        json: first
          ? {
              conversation: { ...ref, channel: "sc:abc" },
              state,
              messages: [
                { seq: 1, author: "customer", body: body.message, at },
                {
                  seq: 2,
                  author: "ai",
                  body: "Her er bordlampen vår. Jeg har åpnet siden for deg.",
                  data: { products: [lamp], actions: [{ type: "navigate", href: `/s/${slug}/no/p/demo-bordlampe`, label: "Bordlampe" }] },
                  at,
                },
              ],
            }
          : { conversation: { id: ref.id, channel: "sc:abc" }, state, messages: [{ seq: 3, author: "customer", body: body.message, at }, { seq: 4, author: "ai", body: "Bare hyggelig!", at }] },
      });
    });
    const fed: Record<string, unknown>[] = [];
    await page.route("**/api/chat/feed", async (route) => {
      fed.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { state, messages: [] } });
    });
    const ended: Record<string, unknown>[] = [];
    await page.route("**/api/chat/end", async (route) => {
      ended.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { state: { ...state, status: "ended" }, messages: [{ seq: 5, author: "system", body: "", kind: "ended", at }] } });
    });

    await page.goto(`/s/${slug}`);
    const launcher = page.getByRole("button", { name: "Chat med oss: Ingrid, AI-assistent" });
    await launcher.click();
    const chat = page.getByRole("dialog", { name: "Ingrid, AI-assistent" });
    await expect(chat).toBeVisible();
    await expect(chat.getByText("Kundeservice")).toBeVisible();
    await expect(chat.getByText("Hei, jeg er Ingrid! Spør meg om lamper.")).toBeVisible();
    await expect(chat.getByText(/Svarene lages av AI/)).toBeVisible();

    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Har dere lamper?");
    await chat.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect(chat.getByText("Her er bordlampen vår. Jeg har åpnet siden for deg.")).toBeVisible();
    // Only the new message goes: no conversation yet, nothing seen before.
    expect(sent[0]).toMatchObject({ store: slug, market: "no", path: `/s/${slug}`, after: 0, message: "Har dere lamper?" });
    expect(sent[0]).not.toHaveProperty("messages");
    expect(sent[0]).not.toHaveProperty("conversation");

    // The agent opened the product page, with the chat still open beside it on a large screen.
    await expect(page).toHaveURL(new RegExp(`/s/${slug}/p/demo-bordlampe$`));
    await expect(page.getByRole("heading", { level: 1, name: "Demo: Bordlampe" })).toBeVisible();
    await expect(chat).toBeVisible();
    const card = chat.getByRole("link", { name: /Demo: Bordlampe/ });
    await expect(card).toContainText("499,00");
    await expect(card).toContainText("inkl. mva.");
    await expect(chat.getByRole("link", { name: "Åpnet: Bordlampe →" })).toBeVisible();

    // The tab keeps a copy and the conversation's reference: after a reload it draws at once, asks for what is new, and the next
    // message carries the reference and the last message seen, never the conversation itself.
    await page.reload();
    await page.getByRole("button", { name: /Chat med oss/ }).click();
    await expect(chat.getByText("Har dere lamper?")).toBeVisible();
    await expect.poll(() => fed.length).toBe(1);
    expect(fed[0]).toMatchObject({ store: slug, market: "no", conversation: ref, after: 2 });
    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Takk!");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByText("Bare hyggelig!")).toBeVisible();
    expect(sent[1]).toMatchObject({ conversation: ref, after: 2, message: "Takk!" });
    expect(sent[1]).not.toHaveProperty("messages");

    // A new conversation forgets it.
    await chat.getByRole("button", { name: "Ny samtale" }).click();
    await expect(chat.getByText("Har dere lamper?")).toHaveCount(0);
    await expect.poll(() => ended.length).toBe(1);
    expect(ended[0]).toMatchObject({ conversation: ref });
    await chat.getByRole("button", { name: "Lukk chatten" }).click();
    await expect(chat).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

/**
 * A person takes over (D216, step 4): the widget asks the site for what is new while a conversation waits for or is with a person,
 * and draws the person's line, name and answer, without the AI label. The site's answers are the browser's stand-ins (the take-over
 * itself is tested in src/server/support.int.test.ts).
 */
test("the customer sees a person join and answer within seconds, without the AI label", async ({ page }) => {
  const slug = `chat-person-${Date.now()}`;
  const sql = testDb();
  try {
    const [access] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Siris Butikk', null) as id`;
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await sql`
      insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint, text_model)
      values (${storeId}, 'openai', ${encryptSecret("sk-test", key)}, '…test', 'text-model')`;
    await sql`insert into commerce.chat_agents (store_id, enabled, name, occupation) values (${storeId}, true, 'Ingrid', 'Kundeservice')`;

    const ref = { id: "0b5c1d2e-3f40-4a51-8b62-7c83d94ea5f6", token: "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123" };
    const base = { status: "open", mode: "ai_first", queue: null, available: true, emailLeft: 0, signedIn: false, emailFollowup: false };
    const at = "2026-10-13T12:00:00.000Z";
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON() as { message: string };
      await route.fulfill({
        json: { conversation: { ...ref, channel: "sc:abc" }, state: { ...base, handler: "queue", agent: null }, messages: [{ seq: 1, author: "customer", body: body.message, at }, { seq: 2, author: "system", body: "", kind: "queued", at }] },
      });
    });
    let polled = 0;
    await page.route("**/api/chat/feed", async (route) => {
      polled += 1;
      await route.fulfill({
        json: {
          state: { ...base, handler: "human", agent: { name: "Kari", picture: null } },
          messages: [
            { seq: 3, author: "system", body: "", kind: "joined", data: { name: "Kari" }, at },
            { seq: 4, author: "agent", body: "Hei! Jeg ser på bestillingen din nå.", data: { name: "Kari", picture: null }, at },
          ],
        },
      });
    });

    await page.goto(`/s/${slug}`);
    await page.getByRole("button", { name: /Chat med oss/ }).click();
    const chat = page.getByRole("dialog");
    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Hvor er pakken min?");
    await chat.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect(chat.getByText("Venter på en person.")).toBeVisible();
    // Waiting for a person, the widget asks every 3 seconds: the person's line and answer are there within 5.
    await expect(chat.getByText("Kari ble med i samtalen.")).toBeVisible({ timeout: 5000 });
    await expect(chat.getByText("Hei! Jeg ser på bestillingen din nå.")).toBeVisible();
    expect(polled).toBeGreaterThan(0);
    // The header is the person's now, never labelled AI.
    await expect(chat.locator("header")).toContainText("Kari");
    await expect(chat.locator("header")).not.toContainText("AI-assistent");
  } finally {
    await sql.end();
  }
});
