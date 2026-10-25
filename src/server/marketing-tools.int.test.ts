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
  };
});

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const ownerTools = await import("./owner-tools");
const subs = await import("./marketing-subscribers");
const { broadcastApprovalSummary } = await import("./marketing-tools");

/**
 * The AI manager's marketing tools (PSI AGT-01): a broadcast drafted by the store's own writer (claims checked) and saved as a draft, sent or
 * scheduled only through the send the Broadcasts page uses after a preflight, segments counted, customer tags written, automations listed.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const ctx = async () => ({ account: store.account, store: (await getStore(store.slug))!, invalidate: () => {} });
const run = async (name: string, args: unknown) => ownerTools.runOwnerTool(await ctx(), name, args);

beforeAll(async () => {
  store = await makeStore("marketing");
});

afterAll(async () => {
  // A scheduled broadcast goes back to a draft before it can be deleted (the database's rules).
  await db().execute(sql`update commerce.broadcasts set status = 'draft' where store_id = ${store.id}::uuid and status = 'scheduled'`);
  await db().execute(sql`delete from commerce.broadcasts where store_id = ${store.id}::uuid`);
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
    expect(automations.automations.map((a) => a.kind)).toEqual(["welcome", "after_purchase", "win_back", "back_in_stock"]);
    expect(automations.automations.every((a) => a.on === false)).toBe(true);
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
});
