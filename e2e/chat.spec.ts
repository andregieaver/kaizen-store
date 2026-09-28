import { expect, test } from "@playwright/test";

import { encryptSecret, parseKey } from "../src/lib/secret-box";

import { testDb } from "./db";

/**
 * The chat agent (D81): a store with an agent and an AI shows the widget,
 * labelled as AI, with the agent's name, occupation and greeting; answers
 * show the store's product cards and open the page the agent opened; the
 * conversation lasts the tab. The model is not called here: the answer is
 * the browser's stand-in for /api/chat (the agent itself is tested in
 * src/server/chat.int.test.ts).
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
    const missing = await request.post("/api/chat", { data: { store: `${slug}-none`, market: "no", messages: [{ role: "user", content: "Hei" }] } });
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
      data: { store: slug, market: "no", messages: [{ role: "user", content: "Hei" }] },
    });
    expect(foreign.status()).toBe(403);
    const unreadable = await request.post("/api/chat", { data: { store: slug, market: "no", messages: [{ role: "assistant", content: "Hei" }] } });
    expect(unreadable.status()).toBe(400);

    const sent: unknown[] = [];
    await page.route("**/api/chat", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          reply: "Her er bordlampen vår. Jeg har åpnet siden for deg.",
          actions: [{ type: "navigate", href: `/s/${slug}/no/p/demo-bordlampe`, label: "Bordlampe" }],
          products: [
            {
              handle: "demo-bordlampe",
              title: "Demo: Bordlampe",
              href: `/s/${slug}/no/p/demo-bordlampe`,
              image: null,
              price: { amountMinor: 49900, currency: "NOK", referenceMinor: null, vat: { rate: 0.25, shown: "incl" } },
              from: false,
            },
          ],
        },
      });
    });

    await page.goto(`/s/${slug}/no`);
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
    expect(sent[0]).toMatchObject({ store: slug, market: "no", path: `/s/${slug}/no`, messages: [{ role: "user", content: "Har dere lamper?" }] });

    // The agent opened the product page, with the chat still open beside it on a large screen.
    await expect(page).toHaveURL(new RegExp(`/s/${slug}/no/p/demo-bordlampe$`));
    await expect(page.getByRole("heading", { level: 1, name: "Demo: Bordlampe" })).toBeVisible();
    await expect(chat).toBeVisible();
    const card = chat.getByRole("link", { name: /Demo: Bordlampe/ });
    await expect(card).toContainText("499,00");
    await expect(card).toContainText("inkl. mva.");
    await expect(chat.getByRole("link", { name: "Åpnet: Bordlampe →" })).toBeVisible();

    // The conversation lasts the tab: after a reload it is still there, and the next message carries it.
    await page.reload();
    await page.getByRole("button", { name: /Chat med oss/ }).click();
    await expect(chat.getByText("Har dere lamper?")).toBeVisible();
    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Takk!");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect((sent[1] as { messages: unknown[] }).messages).toEqual([
      { role: "user", content: "Har dere lamper?" },
      { role: "assistant", content: "Her er bordlampen vår. Jeg har åpnet siden for deg." },
      { role: "user", content: "Takk!" },
    ]);

    // A new conversation forgets it.
    await chat.getByRole("button", { name: "Ny samtale" }).click();
    await expect(chat.getByText("Har dere lamper?")).toHaveCount(0);
    await chat.getByRole("button", { name: "Lukk chatten" }).click();
    await expect(chat).toHaveCount(0);
  } finally {
    await sql.end();
  }
});
