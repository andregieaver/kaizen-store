import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { encryptSecret, parseKey } from "../../src/lib/secret-box";
import { testDb } from "../db";

import { OWNER } from "./accounts";

/**
 * The chat widget and the support inbox together (D216), each as its person uses it: a visitor in one browser on the store, the owner
 * signed in to the inbox in another, every message passing through the real routes, the database and back, never played by SQL. Each
 * case has a store of its own, with the e2e owner added as a member, so other tests' support settings never meet it.
 */

const TEXT = "Hei! Vi har bordlampen på lager, og den sendes i morgen.";

/**
 * An AI provider of its own for the case that needs one: OpenAI's chat completions, whole or streamed, always answering `TEXT` in a few
 * pieces and never asking for a tool. It runs beside the test, where the app's server reaches it at 127.0.0.1.
 */
async function aiStandIn(): Promise<{ url: string; asked: () => number; close: () => Promise<void> }> {
  let asked = 0;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end("{}");
        return;
      }
      asked += 1;
      const stream = (JSON.parse(body || "{}") as { stream?: boolean }).stream;
      if (!stream) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: TEXT } }] }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const piece of TEXT.match(/.{1,9}/g) ?? []) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1`, asked: () => asked, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** A store of its own with support in `mode`, the e2e owner one of its admins, online in its inbox. */
async function deskStore(sql: ReturnType<typeof testDb>, mode: "people" | "ai_first") {
  const slug = `live-${mode.replace("_", "")}-${Date.now().toString(36)}`;
  const [access] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', 'Lampebutikken') returning id`;
  const [{ id: storeId }] = await sql`select commerce.approve_access_request(${access.id}, ${slug}, 'Lampebutikken', null) as id`;
  const [owner] = await sql`select id from commerce.accounts where email = ${OWNER.email}`;
  await sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}, ${owner.id}, 'admin')`;
  await sql`insert into commerce.support_settings (store_id, mode) values (${storeId}, ${mode})`;
  await sql`
    insert into commerce.support_agents (store_id, account_id, status, last_seen_at) values (${storeId}, ${owner.id}, 'online', now())
    on conflict on constraint support_agents_key do update set status = 'online', last_seen_at = now()
  `;
  return { slug, storeId: String(storeId) };
}

/** The owner's inbox for the store, in a browser of its own, kept open (its heartbeat keeps the owner online). */
async function inbox(browser: Browser, slug: string): Promise<Page> {
  const context = await browser.newContext({ storageState: OWNER.state });
  const page = await context.newPage();
  await page.goto(`/admin/${slug}/support`);
  await expect(page.getByRole("tablist")).toBeVisible();
  return page;
}

/** The visitor's chat on the store, open, in a browser of its own (no session, no cookies but the chat's). */
async function visitorChat(browser: Browser, slug: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/s/${slug}`);
  await page.getByRole("button", { name: /^Chat med oss/ }).click();
  const chat = page.getByRole("dialog", { name: /Lampebutikken|Ingrid/ });
  await expect(chat).toBeVisible();
  const send = async (text: string) => {
    await chat.getByRole("textbox", { name: "Skriv en melding" }).fill(text);
    await chat.getByRole("textbox", { name: "Skriv en melding" }).press("Enter");
  };
  return { page, chat, send };
}

/** Opens the conversation in the inbox's list under `tab` (the store has only the case's own; its row shows its latest message). */
async function openInInbox(staff: Page, tab: RegExp) {
  await staff.getByRole("tab", { name: tab }).click();
  const row = staff.getByRole("list", { name: "Conversations" }).getByRole("button").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(staff.getByRole("log", { name: "Messages" })).toBeVisible();
}

/** Takes the open conversation over (it is waiting or with the AI), answers it, and sends. */
async function answer(staff: Page, text: string) {
  const take = staff.getByRole("button", { name: "Take over" });
  await expect(take).toBeVisible({ timeout: 10_000 });
  await take.click();
  await expect(take).toBeHidden({ timeout: 10_000 });
  const box = staff.getByRole("textbox", { name: "Reply to the customer" });
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill(text);
  await staff.getByRole("button", { name: "Send", exact: true }).click();
}

/**
 * Answers the open conversation straight away, as a person who has not pressed Take over: the box is the reply box, it says sending
 * takes the conversation over, and sending does (before, only an internal note could be written there, and the answer never left).
 */
async function answerStraightAway(staff: Page, text: string) {
  const box = staff.getByRole("textbox", { name: "Reply to the customer" });
  await expect(box).toBeVisible({ timeout: 10_000 });
  await expect(staff.getByText("Sending takes the conversation over, so the customer has you from then on.")).toBeVisible();
  await box.fill(text);
  await staff.getByRole("button", { name: "Send", exact: true }).click();
  await expect(staff.getByRole("button", { name: "Take over" })).toBeHidden({ timeout: 10_000 });
}

test.describe.configure({ mode: "serial" });

test("people only: the visitor's message reaches the inbox, the owner's answer reaches the chat, and back again", async ({ browser }) => {
  test.setTimeout(150_000);
  const sql = testDb();
  try {
    const { slug } = await deskStore(sql, "people");
    const staff = await inbox(browser, slug);
    const visitor = await visitorChat(browser, slug);

    await visitor.send("Har dere bordlampen i hvitt?");
    await expect(visitor.chat.getByText("Har dere bordlampen i hvitt?")).toBeVisible();

    // The inbox finds it waiting, without a reload.
    await openInInbox(staff, /^Waiting/);
    await expect(staff.getByText("Har dere bordlampen i hvitt?").last()).toBeVisible();
    await answerStraightAway(staff, "Ja, den finnes i hvitt.");

    // The chat shows who joined and what they wrote, without a reload.
    await expect(visitor.chat.getByText("Ja, den finnes i hvitt.")).toBeVisible({ timeout: 15_000 });
    await expect(visitor.chat.getByText(/ble med i samtalen/)).toBeVisible();

    // And the visitor's answer comes back to the inbox.
    await visitor.send("Supert, takk!");
    await expect(staff.getByText("Supert, takk!").last()).toBeVisible({ timeout: 15_000 });

    // The owner ends it; the chat says so.
    await staff.getByRole("button", { name: "End", exact: true }).click();
    await expect(visitor.chat.getByText(/avsluttet|Hvordan var hjelpen/i).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await sql.end();
  }
});

test("the AI first, with an AI: it answers in the chat as it writes, the inbox shows the conversation with the AI, and a person takes it over", async ({ browser }) => {
  test.setTimeout(150_000);
  const sql = testDb();
  const ai = await aiStandIn();
  try {
    const { slug, storeId } = await deskStore(sql, "ai_first");
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await sql`
      insert into commerce.ai_providers (store_id, provider, base_url, api_key_encrypted, api_key_hint, text_model, enabled)
      values (${storeId}, 'custom', ${ai.url}, ${encryptSecret("sk-stand-in", key)}, '…in', 'stand-in', true)`;
    await sql`
      insert into commerce.chat_agents (store_id, enabled, name, occupation, greeting)
      values (${storeId}, true, 'Ingrid', 'Kundeservice', ${sql.json({ "nb-NO": "Hei, jeg er Ingrid!" })})`;
    const staff = await inbox(browser, slug);
    const visitor = await visitorChat(browser, slug);

    await visitor.send("Har dere bordlampen på lager?");
    // The AI's answer, whole once kept (it streams in finished sentences first).
    await expect(visitor.chat.getByText(TEXT)).toBeVisible({ timeout: 20_000 });
    expect(ai.asked()).toBeGreaterThan(0);

    // Opened now, with nobody waiting, the inbox starts on All open, the conversation with the AI in it.
    await staff.reload();
    await expect(staff.getByRole("tab", { name: "All open" })).toHaveAttribute("aria-selected", "true");
    await expect(staff.getByRole("list", { name: "Conversations" }).getByRole("button").first()).toBeVisible();
    // And under With the AI, with both messages.
    await openInInbox(staff, /^With the AI/);
    await expect(staff.getByText(TEXT).last()).toBeVisible();

    // The owner takes it over and answers; the chat shows it.
    await answer(staff, "Jeg tar over herfra. Hvilken farge vil du ha?");
    await expect(visitor.chat.getByText("Jeg tar over herfra. Hvilken farge vil du ha?")).toBeVisible({ timeout: 15_000 });

    // The visitor's answer reaches the owner, and the AI no longer answers in the chat (the model may still be asked for the message's
    // tone and by the owner's partner, so what counts is what the visitor sees).
    await visitor.send("Hvit, takk.");
    await expect(staff.getByText("Hvit, takk.").last()).toBeVisible({ timeout: 15_000 });
    await visitor.page.waitForTimeout(3000);
    await expect(visitor.chat.getByText(TEXT)).toHaveCount(1);
  } finally {
    await ai.close();
    await sql.end();
  }
});

test("the AI first, asked for a person: the conversation waits in the inbox, and the owner's answer reaches the chat", async ({ browser }) => {
  test.setTimeout(150_000);
  const sql = testDb();
  const ai = await aiStandIn();
  try {
    const { slug, storeId } = await deskStore(sql, "ai_first");
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await sql`
      insert into commerce.ai_providers (store_id, provider, base_url, api_key_encrypted, api_key_hint, text_model, enabled)
      values (${storeId}, 'custom', ${ai.url}, ${encryptSecret("sk-stand-in", key)}, '…in', 'stand-in', true)`;
    await sql`
      insert into commerce.chat_agents (store_id, enabled, name, occupation, greeting)
      values (${storeId}, true, 'Ingrid', 'Kundeservice', ${sql.json({ "nb-NO": "Hei, jeg er Ingrid!" })})`;
    const staff = await inbox(browser, slug);
    const visitor = await visitorChat(browser, slug);

    await visitor.send("Kan jeg bytte en lampe?");
    await expect(visitor.chat.getByText(TEXT)).toBeVisible({ timeout: 20_000 });
    await visitor.chat.getByRole("button", { name: "Snakk med en person" }).click();

    await openInInbox(staff, /^Waiting/);
    await answer(staff, "Ja, du kan bytte innen 30 dager.");
    await expect(visitor.chat.getByText("Ja, du kan bytte innen 30 dager.")).toBeVisible({ timeout: 15_000 });
  } finally {
    await ai.close();
    await sql.end();
  }
});
