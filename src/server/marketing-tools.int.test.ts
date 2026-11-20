import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A gift card's code is kept as an HMAC of the settings key (D300).
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

/** The store's AI, scripted: the broadcast writer's answer. */
const model = vi.hoisted(() => ({ reply: "" }));
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return {
    ...real,
    aiFor: async () => ({ provider: "openai", textModel: "fake", usage: { storeId: null, feature: "marketing_email", accountId: null } }),
    completeText: async () => ({ text: model.reply }),
    // The broadcast writer asks with its tools (D352); this model answers at once without asking for any.
    chatWithTools: async () => ({ content: model.reply, toolCalls: [] }),
  };
});

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const ownerTools = await import("./owner-tools");
const subs = await import("./marketing-subscribers");
const { broadcastApprovalSummary, segmentApprovalSummary } = await import("./marketing-tools");

/**
 * The AI manager's marketing tools (PSI AGT-01): a broadcast drafted by the store's own writer (claims checked) and saved as a draft, sent or
 * scheduled only through the send the Broadcasts page uses after a preflight, segments counted, customer tags written, automations listed.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const ctx = async () => ({ account: store.account, store: (await getStore(store.slug))!, holder: { role: "owner" as const }, invalidate: () => {} });
const run = async (name: string, args: unknown) => ownerTools.runOwnerTool(await ctx(), name, args);

beforeAll(async () => {
  store = await makeStore("marketing");
});

afterAll(async () => {
  // A scheduled broadcast goes back to a draft before it can be deleted (the database's rules).
  await db().execute(sql`update commerce.broadcasts set status = 'draft' where store_id = ${store.id}::uuid and status = 'scheduled'`);
  await db().execute(sql`delete from commerce.broadcasts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.sms_campaigns where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the marketing tools", () => {
  it("drafts a broadcast from a few words, saves nothing that makes a claim, and sends nothing", async () => {
    model.reply = JSON.stringify({ subject: "Autumn news", preview: "What is new", heading: "Hello", paragraphs: ["Our autumn coffee is here."], button: "See it" });
    const made = (await run("draft_broadcast", { brief: "Our autumn coffee arrived", name: "Autumn" })) as { id: string; subject: string; done: string };
    expect(made.subject).toBe("Autumn news");
    expect(made.done).toContain("Nothing is sent");
    const listed = (await run("list_broadcasts", {})) as { broadcasts: { id: string; status: string; name: string }[] };
    expect(listed.broadcasts).toEqual([expect.objectContaining({ id: made.id, status: "draft", name: "Autumn" })]);

    model.reply = JSON.stringify({ subject: "Last chance", preview: "", heading: "Only today", paragraphs: ["Only today: the best price ever."], button: "" });
    await expect(run("draft_broadcast", { brief: "A sale", name: "Sale" })).rejects.toThrow(/claims/);
    expect(((await run("list_broadcasts", {})) as { total: number }).total).toBe(1);
  });

  it("refuses to keep a send that would reach nobody, and describes one that would from the broadcast", async () => {
    const c = await ctx();
    await expect(ownerTools.preflightOwnerTool(c, "send_broadcast", { broadcast: "Autumn" })).rejects.toThrow(/Nobody on the list/);
    await expect(ownerTools.preflightOwnerTool(c, "send_broadcast", { broadcast: "Nothing" })).rejects.toThrow(/No broadcast "Nothing"/);
    await subs.joinList({ storeId: store.id, email: "reader@example.com", locale: "nb-NO", marketCode: "NO", source: "form", consentText: "Yes, send me news.", proof: "confirmed" });
    await ownerTools.preflightOwnerTool(c, "send_broadcast", { broadcast: "Autumn" });
    const summary = await broadcastApprovalSummary(c.store, { broadcast: "autumn" });
    expect(summary).toBe('Send the broadcast "Autumn" ("Autumn news") now to everyone on the list who asked for your emails (1 person now).');
  });

  it("schedules a send at the store's wall-clock time, through the page's own schedule", async () => {
    const c = await ctx();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: c.store.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 2 * 86_400_000));
    const done = (await run("send_broadcast", { broadcast: "Autumn", at: `${day} 10:00` })) as { done: string };
    expect(done.done).toContain("is scheduled for");
    expect(done.done).toContain("10:00");
    const [row] = await db().execute<{ status: string }>(sql`select status from commerce.broadcasts where store_id = ${store.id}::uuid and title = 'Autumn'`);
    expect(row.status).toBe("scheduled");
  });

  it("counts segments, tags a customer and lists the automations", async () => {
    expect(await run("list_segments", {})).toMatchObject({ segments: [], total: 0 });
    expect(await run("tag_customer", { email: "reader@example.com", tag: "Coffee club" })).toEqual({ done: 'Tagged "Coffee club".' });
    expect(await run("tag_customer", { email: "reader@example.com", tag: "Coffee club", remove: true })).toEqual({ done: 'The tag "Coffee club" is taken off.' });
    await expect(run("tag_customer", { email: "reader@example.com", tag: "Coffee club", remove: true })).rejects.toThrow(/no tag/);
    const automations = (await run("list_email_automations", {})) as { automations: { kind: string; on: boolean }[] };
    expect(automations.automations.map((a) => a.kind)).toEqual(["welcome", "after_purchase", "win_back", "cross_sell", "replenish", "browse", "back_in_stock"]);
    expect(automations.automations.every((a) => a.on === false)).toBe(true);
  });

  it("writes an automation's words and days with the store's writer, refusing days outside its range and claims (D4)", async () => {
    const c = await ctx();
    await expect(ownerTools.preflightOwnerTool(c, "write_email_automation", { kind: "welcome", brief: "Say hello", days: 60 })).rejects.toThrow(/from 0 to 30/);
    model.reply = JSON.stringify({ subject: "Welcome to the shop", preview: "Glad you came", heading: "Hello", paragraphs: ["We roast coffee every week."], button: "" });
    const done = (await run("write_email_automation", { kind: "welcome", brief: "Welcome them and tell them about our roastery", days: 2 })) as { done: string; subject: string };
    expect(done.subject).toBe("Welcome to the shop");
    expect(done.done).toContain("Sent 2 days after they join.");
    expect(done.done).toContain("It is off");
    const [row] = await db().execute<{ delay_days: number; content: Record<string, { subject: string }> }>(
      sql`select delay_days, content from commerce.automations where store_id = ${store.id}::uuid and kind = 'welcome'`,
    );
    expect(row.delay_days).toBe(2);
    expect(row.content[c.store.localization.locales[0]].subject).toBe("Welcome to the shop");
    model.reply = JSON.stringify({ subject: "Last chance", preview: "", heading: "Only today", paragraphs: ["The best price ever."], button: "" });
    await expect(run("write_email_automation", { kind: "welcome", brief: "A sale" })).rejects.toThrow(/claims/);
  });

  it("writes a follow-up with the same writer, only after the first and in order, and lists it (D653)", async () => {
    const c = await ctx();
    await expect(ownerTools.preflightOwnerTool(c, "write_email_automation", { kind: "win_back", brief: "Come back", step: 2 })).rejects.toThrow(/write step 1 first/);
    await expect(ownerTools.preflightOwnerTool(c, "write_email_automation", { kind: "welcome", brief: "Again", step: 3 })).rejects.toThrow(/write step 2 first/);
    await expect(ownerTools.preflightOwnerTool(c, "write_email_automation", { kind: "welcome", brief: "Again", step: 2, days: 90 })).rejects.toThrow(/from 1 to 60/);
    model.reply = JSON.stringify({ subject: "Still here?", preview: "", heading: "A small reminder", paragraphs: ["Have a look when you have time."], button: "" });
    const done = (await run("write_email_automation", { kind: "welcome", brief: "A gentle second hello", step: 2, days: 4 })) as { done: string; link: string };
    expect(done.done).toContain("second email is added");
    expect(done.link).toMatch(/\/automations\/welcome\/follow-ups\/2$/);
    const listed = (await run("list_email_automations", {})) as { automations: { kind: string; follow_ups?: { step: number; subject: string }[]; products?: string }[] };
    const welcome = listed.automations.find((a) => a.kind === "welcome");
    expect(welcome?.follow_ups).toEqual([{ step: 2, when: "4 days after the email before, if they have not ordered since the first", subject: "Still here?" }]);
    expect(listed.automations.find((a) => a.kind === "cross_sell")?.products).toMatch(/chooses for the reader/);
  });

  it("lists, writes and switches the cart reminders, refusing claims, a code the store lacks and a time outside its range (D653)", async () => {
    const c = await ctx();
    const before = (await run("cart_reminder_stats", {})) as { on: boolean; reminders: unknown[] };
    expect(before).toMatchObject({ on: false, reminders: [] });
    const words = { subject: "Your cart at {store}", heading: "Still thinking?", body: "Your cart is saved for you.", button: "Back to the cart" };
    await expect(ownerTools.preflightOwnerTool(c, "write_cart_reminder", { ...words })).rejects.toThrow(/after how many hours/);
    await expect(ownerTools.preflightOwnerTool(c, "write_cart_reminder", { ...words, after_hours: 0.25 })).rejects.toThrow(/after_hours/);
    await expect(ownerTools.preflightOwnerTool(c, "write_cart_reminder", { ...words, after_hours: 2, body: "The best price ever." })).rejects.toThrow(/claims/);
    await expect(ownerTools.preflightOwnerTool(c, "write_cart_reminder", { ...words, after_hours: 2, discount_code: "NOPE-NOT-HERE" })).rejects.toThrow(/no discount code/);

    expect(((await run("switch_email_automation", { kind: "cart_reminders", on: true })) as { done: string }).done).toContain("3 reminders go");
    const added = (await run("write_cart_reminder", { ...words, after_hours: 2 })) as { id: string; done: string };
    expect(added.done).toContain("A reminder is added");
    const after = (await run("cart_reminder_stats", {})) as { on: boolean; reminders: { id: string; after: string; on: boolean; subject: string }[] };
    expect(after.on).toBe(true);
    expect(after.reminders).toHaveLength(4);
    expect(after.reminders.find((r) => r.id === added.id)).toMatchObject({ after: "2 hours", on: true, subject: "Your cart at {store}" });

    const changed = (await run("write_cart_reminder", { ...words, reminder: added.id, subject: "Your cart is waiting", on: false })) as { done: string };
    expect(changed.done).toContain("has new words");
    const last = (await run("cart_reminder_stats", {})) as { reminders: { id: string; after: string; on: boolean; subject: string }[] };
    expect(last.reminders.find((r) => r.id === added.id)).toMatchObject({ after: "2 hours", on: false, subject: "Your cart is waiting" });
    expect(((await run("switch_email_automation", { kind: "cart_reminders", on: false })) as { done: string }).done).toBe("Cart reminders are off.");
  });

  it("counts the paid orders a reader placed within a week of an automation's email (D4)", async () => {
    const [sub] = await db().execute<{ id: string }>(sql`select id from commerce.marketing_subscribers where store_id = ${store.id}::uuid and email = 'reader@example.com'`);
    await db().execute(sql`
      insert into commerce.automation_sends (store_id, key, kind, subscriber_id, outcome, created_at)
      values (${store.id}::uuid, ${`welcome:${sub.id}`}, 'welcome', ${sub.id}::uuid, 'sent', now() - interval '2 days')
    `);
    for (const [number, daysAgo] of [["A-1", 1], ["A-2", 10]] as const) {
      const [o] = await db().execute<{ id: string }>(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
          total_minor, billing_address, shipping_address, placed_at)
        values (${store.id}::uuid, ${`${number}-${Date.now().toString(36)}`}, 'NO', 'NOK', 'nb-NO', 'Reader@example.com', 'paid', 45000, 0, 0, 9000, 45000, '{}'::jsonb, '{}'::jsonb,
          now() - ${daysAgo} * interval '1 day')
        returning id
      `);
      await db().execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
        values (${store.id}::uuid, ${o.id}::uuid, 'stripe', ${`pi_${number}_${o.id}`}, 'acct_auto', 45000, 0, 'NOK', 'captured')
      `);
    }
    const listed = (await run("list_email_automations", {})) as { automations: { kind: string; orders_after?: number; revenue_after?: string[] }[] };
    const welcome = listed.automations.find((a) => a.kind === "welcome")!;
    // The order ten days ago came before the email; only the one a day ago follows it.
    expect(welcome.orders_after).toBe(1);
    expect(welcome.revenue_after).toEqual([expect.stringMatching(/^450,00\skr$/)]);
  });

  it("drafts a text message without claims and keeps no send while no 46elks account is connected (D4)", async () => {
    const c = await ctx();
    expect(await run("list_text_messages", {})).toMatchObject({ connected: false });
    await expect(run("draft_text_message", { name: "Sale", text: "Only today: the best price ever!" })).rejects.toThrow(/claims/);
    const made = (await run("draft_text_message", { name: "Roastery news", text: "New beans from our roastery are in. Come and taste them!" })) as { id: string; done: string };
    expect(made.done).toContain("Nothing is sent");
    await expect(ownerTools.preflightOwnerTool(c, "send_text_message", { message: "Roastery news" })).rejects.toThrow(/Connect a 46elks account/);
    await expect(ownerTools.preflightOwnerTool(c, "send_text_message", { message: "Nothing" })).rejects.toThrow(/No text message "Nothing"/);
  });

  it("describes a segment kept for a yes by its rules, in the store's own money (D439)", async () => {
    const rules = { match: "all", conditions: [{ kind: "orders", op: "atLeast", value: 2 }, { kind: "spent", op: "atLeast", minor: 100_000 }] };
    expect(await segmentApprovalSummary((await ctx()).store, { name: "Big spenders", rules })).toMatch(
      /^Save the segment "Big spenders": Ordered at least 2 times · and Spent at least 1\s000,00\skr \(without VAT\)\. Shoppers see nothing of it\.$/,
    );
    expect(await segmentApprovalSummary((await ctx()).store, { name: "Big spenders", rules: { match: "all" } })).toBeNull();
  });

  it("issues a gift card only by email, and never answers with its code", async () => {
    await db().execute(sql`update commerce.stores set features = array_append(features, 'gift_cards') where id = ${store.id}::uuid and not ('gift_cards' = any(features))`);
    const fresh = await ctx();
    await expect(ownerTools.preflightOwnerTool(fresh, "issue_gift_card", { amount: "0", to: "friend@example.com", reason: "Goodwill" })).rejects.toThrow(/above zero/);
    await expect(ownerTools.preflightOwnerTool(fresh, "issue_gift_card", { amount: "100", currency: "JPY", to: "friend@example.com", reason: "Goodwill" })).rejects.toThrow(/does not sell in JPY/);
    const issued = await ownerTools.runOwnerTool(fresh, "issue_gift_card", { amount: "250", to: "friend@example.com", name: "Kari", reason: "Goodwill after a late parcel" });
    expect(issued).toMatchObject({ done: expect.stringContaining("emailed it to friend@example.com"), link: expect.stringContaining("/gift-cards/") });
    // A code is four groups of four: none in the answer (the card's id in its link is a UUID, whose digit-only groups would look like one).
    expect(JSON.stringify(issued).replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, "")).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
    const [card] = await db().execute<{ initial_minor: string; recipient_email: string }>(sql`
      select initial_minor, recipient_email from commerce.gift_cards where store_id = ${store.id}::uuid order by created_at desc limit 1
    `);
    expect(card).toMatchObject({ recipient_email: "friend@example.com" });
  });

  it("lists the store's flows and the goals it lacks, and starts one switched off, once (D855, M3.9)", async () => {
    const before = (await run("list_flows", {})) as { flows: unknown[]; goals_without_a_flow: { goal: string }[] };
    expect(before.goals_without_a_flow.map((g) => g.goal)).toContain("win_back");
    const started = (await run("start_flow", { goal: "win_back" })) as { done: string; link: string };
    expect(started.done).toContain("switched off and untested");
    const after = (await run("list_flows", {})) as { flows: { name: string; on: boolean }[]; goals_without_a_flow: { goal: string }[] };
    expect(after.flows).toEqual(expect.arrayContaining([expect.objectContaining({ on: false })]));
    expect(after.goals_without_a_flow.map((g) => g.goal)).not.toContain("win_back");
    await expect(run("start_flow", { goal: "win_back" })).rejects.toThrow(/already has a flow/);
  });
});
