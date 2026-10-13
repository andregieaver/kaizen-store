import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { encryptSecret, parseKey } from "../src/lib/secret-box";

import { testDb } from "./db";

/**
 * Support from the visitor's side (D216, `docs/support.md` 6.3), against the real routes. The admin cannot be signed in here, so the
 * person answering is played by the database (`support_transition()` and `support_add_message()`), as the inbox's actions call them.
 */

async function newStore(sql: ReturnType<typeof testDb>, slug: string, name: string) {
  const [access] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', ${name}) returning id`;
  const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, ${name}, null) as id`;
  const [owner] = await sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`;
  return { storeId: String(storeId), ownerId: String(owner.id) };
}

test("people only: the visitor waits, leaves an email, a person answers in the chat and by email, and the link opens the conversation (case 1)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const slug = `support-${Date.now()}`;
  const sql = testDb();
  try {
    const { storeId, ownerId } = await newStore(sql, slug, "Siris Butikk");
    await sql`insert into commerce.support_settings (store_id, mode) values (${storeId}, 'people')`;

    // No agent and no AI: the chat is the store's people, with no AI persona or label.
    await page.goto(`/s/${slug}`);
    await page.getByRole("button", { name: "Chat med oss: Siris Butikk" }).click();
    const chat = page.getByRole("dialog", { name: "Siris Butikk" });
    await expect(chat.getByText("Teamet vårt svarer her")).toBeVisible();
    await expect(chat.getByText("Skriv til oss, så svarer noen fra Siris Butikk.")).toBeVisible();
    await expect(chat.getByText(/AI-assistent/)).toHaveCount(0);
    await expect(chat.getByText("Folk fra Siris Butikk svarer her. Vi tar vare på samtalen i opptil 90 dager.")).toBeVisible();

    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Har dere bordlampen på lager?");
    await chat.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect(chat.getByText("Du er nummer 1 i køen.")).toBeVisible();
    // Nobody is online: the email card.
    await expect(chat.getByText(/Ingen kan svare akkurat nå/)).toBeVisible();
    await chat.getByRole("textbox", { name: "Navn (valgfritt)" }).fill("Kari");
    await chat.getByRole("textbox", { name: "E-post" }).fill(`visitor-${slug}@example.com`);
    await chat.getByRole("button", { name: "Send meg svaret" }).click();
    await expect(chat.getByText(`Vi svarer til visitor-${slug}@example.com.`)).toBeVisible();

    // A person takes it and answers (the inbox's actions, played by the database).
    const [conversation] = await sql`select id from commerce.support_conversations where store_id = ${storeId}`;
    const id = String(conversation.id);
    await sql`update commerce.accounts set name = 'Ola Nordmann' where id = ${ownerId}`;
    await sql`select commerce.support_transition(${id}, 'claim', 'agent', ${ownerId}, null, null, 'Ola')`;
    await sql`select * from commerce.support_add_message(${id}, 'agent', ${ownerId}, 'Ja, vi har tre igjen.', null, ${sql.json({ name: "Ola", picture: null })})`;
    await expect(chat.getByText("Ola ble med i samtalen.")).toBeVisible({ timeout: 5000 });
    await expect(chat.getByText("Ja, vi har tre igjen.")).toBeVisible({ timeout: 5000 });
    // A reply the AI translated for the person says so (step 13); one in their own words does not.
    await expect(chat.getByText("Oversatt av KI")).toHaveCount(0);
    await sql`select * from commerce.support_add_message(${id}, 'agent', ${ownerId}, 'Vi sender dem i morgen.', null, ${sql.json({ name: "Ola", picture: null, translated: true })})`;
    await expect(chat.getByText("Vi sender dem i morgen.")).toBeVisible({ timeout: 5000 });
    await expect(chat.getByText("Oversatt av KI")).toHaveCount(1);

    // The visitor leaves; the next answer goes by email with a link back.
    await chat.getByRole("button", { name: "Lukk chatten" }).click();
    await page.goto("about:blank");
    await sql`select * from commerce.support_add_message(${id}, 'agent', ${ownerId}, 'De sendes i dag.', null, ${sql.json({ name: "Ola", picture: null })})`;
    await sql`update commerce.support_conversations set visitor_seen_at = now() - interval '5 minutes' where id = ${id}`;
    // The email waits until the answer is a minute old and the visitor has not looked (messages are never edited, so the test waits too).
    const cron = () => request.get("/api/cron/integrations", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret"}` } });
    const replies = () => sql`select to_address, text from commerce.email_messages where kind = 'support.reply' and store_id = ${storeId}`;
    await expect
      .poll(
        async () => {
          expect((await cron()).ok()).toBe(true);
          return (await replies()).length;
        },
        { timeout: 100_000, intervals: [5_000] },
      )
      .toBe(1);
    const [email] = await replies();
    expect(email.to_address).toBe(`visitor-${slug}@example.com`);
    expect(String(email.text)).toContain("De sendes i dag.");
    const link = /https?:\/\/[^\s)]+\/account\/support\/[A-Za-z0-9_-]+/.exec(String(email.text))![0];

    // The link's page shows the conversation, with no chat widget, and takes an answer.
    await page.goto(new URL(link).pathname);
    await expect(page.getByRole("heading", { level: 1, name: "Samtalen din med Siris Butikk" })).toBeVisible();
    await expect(page.getByText("De sendes i dag.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Chat med oss/ })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Skriv en melding" }).fill("Takk, jeg kommer innom!");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Takk, jeg kommer innom!")).toBeVisible();
    await expect
      .poll(async () => (await sql`select author, body from commerce.support_messages where conversation_id = ${id} order by seq desc limit 1`)[0])
      .toMatchObject({ author: "customer", body: "Takk, jeg kommer innom!" });
  } finally {
    await sql.end();
  }
});

test("the AI first, with an AI that cannot answer: the visitor's message goes to a person (case 5)", async ({ page }) => {
  const slug = `support-ai-${Date.now()}`;
  const sql = testDb();
  try {
    const { storeId } = await newStore(sql, slug, "Lampebutikken");
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    // An AI whose address answers nothing.
    await sql`
      insert into commerce.ai_providers (store_id, provider, base_url, api_key_encrypted, api_key_hint, text_model)
      values (${storeId}, 'custom', 'https://127.0.0.1:9/v1', ${encryptSecret("sk-test", key)}, '…test', 'text-model')`;
    await sql`insert into commerce.chat_agents (store_id, enabled, name, occupation) values (${storeId}, true, 'Ingrid', 'Kundeservice')`;
    await sql`insert into commerce.support_settings (store_id, mode) values (${storeId}, 'ai_first')`;

    await page.goto(`/s/${slug}`);
    await page.getByRole("button", { name: "Chat med oss: Ingrid, AI-assistent" }).click();
    const chat = page.getByRole("dialog", { name: "Ingrid, AI-assistent" });
    await expect(chat.getByText(/Du chatter med Ingrid, en AI-assistent\. Du kan når som helst be om å snakke med en person\./)).toBeVisible();
    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Hei!");
    await chat.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect(chat.getByText("Venter på en person.")).toBeVisible({ timeout: 20_000 });
    await expect(chat.getByText("Du er nummer 1 i køen.")).toBeVisible();
    await expect(chat.getByRole("button", { name: "Fortsett med assistenten" })).toBeVisible();
    const [row] = await sql`select handler, handoff_reason from commerce.support_conversations where store_id = ${storeId}`;
    expect(row).toMatchObject({ handler: "queue", handoff_reason: "no_ai" });
  } finally {
    await sql.end();
  }
});

test("a person ends the conversation: the rating card appears and the rating is kept (case 3)", async ({ page }) => {
  const slug = `support-rate-${Date.now()}`;
  const sql = testDb();
  try {
    const { storeId, ownerId } = await newStore(sql, slug, "Vurderingsbutikken");
    await sql`insert into commerce.support_settings (store_id, mode) values (${storeId}, 'people')`;
    await page.goto(`/s/${slug}`);
    await page.getByRole("button", { name: "Chat med oss: Vurderingsbutikken" }).click();
    const chat = page.getByRole("dialog", { name: "Vurderingsbutikken" });
    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Hei, et spørsmål");
    await chat.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect(chat.getByText("Du er nummer 1 i køen.")).toBeVisible();

    const [conversation] = await sql`select id from commerce.support_conversations where store_id = ${storeId}`;
    const id = String(conversation.id);
    await sql`select commerce.support_transition(${id}, 'claim', 'agent', ${ownerId}, null, null, 'Ola')`;
    await sql`select * from commerce.support_add_message(${id}, 'agent', ${ownerId}, 'Det ordner seg!', null, ${sql.json({ name: "Ola", picture: null })})`;
    await expect(chat.getByText("Det ordner seg!")).toBeVisible({ timeout: 5000 });
    await sql`select commerce.support_transition(${id}, 'end', 'agent', ${ownerId}, null, null, 'Ola')`;

    await expect(chat.getByText("Samtalen er avsluttet.")).toBeVisible({ timeout: 5000 });
    const card = chat.getByRole("listitem").filter({ hasText: "Fikk du hjelp?" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Ja" }).click();
    await expect(card.getByText("Takk for at du sa ifra.")).toBeVisible();
    await card.getByRole("textbox", { name: "Noe du vil legge til? (valgfritt)" }).fill("Rask hjelp");
    await card.getByRole("button", { name: "Send", exact: true }).click();
    await expect
      .poll(async () => (await sql`select rating, rating_comment from commerce.support_conversations where id = ${id}`)[0])
      .toMatchObject({ rating: "good", rating_comment: "Rask hjelp" });
  } finally {
    await sql.end();
  }
});

test("a person asks the visitor to sign in: the card in the chat takes the email and the code and links the conversation (step 9)", async ({ page }) => {
  const slug = `support-signin-${Date.now()}`;
  const sql = testDb();
  try {
    const { storeId, ownerId } = await newStore(sql, slug, "Innloggingsbutikken");
    await sql`insert into commerce.support_settings (store_id, mode) values (${storeId}, 'people')`;
    await page.goto(`/s/${slug}`);
    await page.getByRole("button", { name: "Chat med oss: Innloggingsbutikken" }).click();
    const chat = page.getByRole("dialog", { name: "Innloggingsbutikken" });
    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill("Hvor er pakken min?");
    await chat.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
    await expect(chat.getByText("Du er nummer 1 i køen.")).toBeVisible();

    const [conversation] = await sql`select id from commerce.support_conversations where store_id = ${storeId}`;
    const id = String(conversation.id);
    await sql`select commerce.support_transition(${id}, 'claim', 'agent', ${ownerId}, null, null, 'Ola')`;
    await sql`select * from commerce.support_add_message(${id}, 'system', ${ownerId}, '', 'sign_in', null)`;

    const card = chat.getByRole("listitem").filter({ hasText: "Logg inn med e-posten din" });
    await expect(card).toBeVisible({ timeout: 5000 });
    const email = `kunde-${slug}@example.com`;
    await card.getByRole("textbox", { name: "E-post" }).fill(email);
    await card.getByRole("button", { name: "Send kode" }).click();
    await expect(chat.getByText(`Vi har sendt en kode til ${email}.`, { exact: false })).toBeVisible();
    // The emailed code is the store's own; the test puts in one it knows (the newest code is the one that counts).
    const code = "123456";
    const hash = createHash("sha256").update(`${storeId}:${email}:${code}`).digest("hex");
    await sql`update commerce.customer_codes set used_at = now() where store_id = ${storeId} and lower(email) = ${email} and used_at is null`;
    await sql`insert into commerce.customer_codes (store_id, email, code_hash, expires_at) values (${storeId}, ${email}, ${hash}, now() + interval '10 minutes')`;
    await chat.getByRole("textbox", { name: "Kode" }).fill(code);
    await chat.getByRole("button", { name: "Logg inn" }).click();
    await expect(chat.getByText("Du er logget inn.")).toBeVisible();
    const [linked] = await sql`select c.customer_id, cu.email from commerce.support_conversations c join commerce.customers cu on cu.id = c.customer_id where c.id = ${id}`;
    expect(linked.email).toBe(email);
    expect((await page.context().cookies()).some((cookie) => cookie.name === `account_${storeId}`)).toBe(true);
  } finally {
    await sql.end();
  }
});
