import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { agoWords, handlerWords, systemWords, toneWords } from "@/lib/support-inbox-text";
import type { InboxRow, StaffConversation } from "@/server/support";

import { availableActs, ConversationActions } from "./conversation-actions";
import { ConversationList } from "./conversation-list";
import { ConversationContext, ConversationView } from "./conversation-view";
import { conversationHref } from "./desk-context";

/** What a person reads: comment markers out, entities made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const now = new Date("2026-10-13T12:00:00Z");
const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: "6f1e4c2a-1b2c-4d3e-8f90-123456789abc",
  store: null,
  status: "open",
  handler: "queue",
  source: "site",
  who: "Kari Nordmann",
  email: "kari@example.com",
  signedIn: true,
  preview: "Where is my parcel?",
  lastMessageAt: "2026-10-13T11:57:00Z",
  queuedAt: "2026-10-13T11:55:00Z",
  assignee: null,
  tone: -45,
  unread: true,
  summaryTitle: null,
  endedAt: null,
  ...over,
});

const conversation = (over: Partial<StaffConversation> = {}): StaffConversation => ({
  id: "6f1e4c2a-1b2c-4d3e-8f90-123456789abc",
  store: { slug: "demo", name: "Demo store" },
  status: "open",
  handler: "ai",
  source: "site",
  who: "Visitor 6F1E",
  email: null,
  signedIn: false,
  locale: "nb-NO",
  market: "no",
  pagePath: "/s/demo/p/lamp",
  assignee: null,
  tone: 10,
  startedAt: "2026-10-13T11:50:00Z",
  endedAt: null,
  endedBy: null,
  handoffReason: null,
  summary: null,
  rating: null,
  messageSeq: 5,
  messages: [
    { seq: 1, author: "customer", body: "Hei, har dere lamper?", kind: null, data: null, by: null, tone: -30, toneLabel: "worried", tools: [], at: "2026-10-13T11:50:00Z" },
    { seq: 2, author: "ai", body: "Ja, her er bordlampen.", kind: null, data: null, by: null, tone: null, toneLabel: null, tools: ["search_products"], at: "2026-10-13T11:50:05Z" },
    { seq: 3, author: "note", body: "Returning customer", kind: null, data: null, by: "Ola", tone: null, toneLabel: null, tools: [], at: "2026-10-13T11:51:00Z" },
    { seq: 4, author: "partner", body: "Order 1042 was sent yesterday.", kind: "suggestion", data: null, by: null, tone: null, toneLabel: null, tools: [], at: "2026-10-13T11:51:05Z" },
    { seq: 5, author: "system", body: "", kind: "joined", data: { name: "Ola" }, by: null, tone: null, toneLabel: null, tools: [], at: "2026-10-13T11:52:00Z" },
  ],
  ...over,
});

describe("the inbox's words (D216, 2.4)", () => {
  it("says how long ago in the shortest words", () => {
    expect(agoWords("2026-10-13T12:00:00Z", now)).toBe("just now");
    expect(agoWords("2026-10-13T11:57:00Z", now)).toBe("3 min");
    expect(agoWords("2026-10-13T10:00:00Z", now)).toBe("2 h");
    expect(agoWords("2026-10-10T12:00:00Z", now)).toBe("3 d");
  });

  it("says who answers: the AI, waiting and for how long, the person who has it, or ended", () => {
    expect(handlerWords(row(), now)).toBe("Waiting 5 min");
    expect(handlerWords(row({ handler: "ai" }), now)).toBe("AI");
    expect(handlerWords(row({ handler: "human", assignee: { id: "a", name: "Ola" } }), now)).toBe("Ola");
    expect(handlerWords(row({ status: "ended" }), now)).toBe("Ended");
  });

  it("words system lines, and says nothing of a kind it does not know", () => {
    expect(systemWords("joined", { name: "Ola" })).toBe("Ola joined the conversation");
    expect(systemWords("queued", null)).toBe("Waiting for a person");
    expect(systemWords("something_new", null)).toBeNull();
  });

  it("gives a tone its band in words and its score, never colour alone", () => {
    expect(toneWords(-45)).toEqual({ band: "bad", words: "Bad (-45)", level: 2 });
    expect(toneWords(70)).toEqual({ band: "very_good", words: "Very good (+70)", level: 5 });
    expect(toneWords(null)).toBeNull();
  });

  it("opens a conversation through its own store at the owner's level", () => {
    expect(conversationHref({ conversationUrl: "/admin/{store}/support/c" }, "abc", "demo", 4)).toBe("/admin/demo/support/c/abc?after=4");
    expect(conversationHref({ conversationUrl: "/admin/platform/support/c" }, "abc", null, 0)).toBe("/admin/platform/support/c/abc?after=0");
  });
});

describe("the list (C19)", () => {
  it("shows who, the last line, who answers, the tone in words, unread and the time", () => {
    const out = html(h(ConversationList, { rows: [row()], selected: null, now, empty: "Nobody" }));
    expect(out).toContain("Kari Nordmann");
    expect(out).toContain("Where is my parcel?");
    expect(out).toContain("Waiting 5 min");
    expect(out).toContain("Tone: Bad (-45)");
    expect(out).toContain('aria-label="Unread"');
    expect(out).toContain("3 min");
    expect(out).toContain("Signed in");
  });

  it("names the store at the owner's level, prefers a summary's title, and says when there is nothing", () => {
    const out = html(h(ConversationList, { rows: [row({ store: { slug: "demo", name: "Demo store" }, summaryTitle: "Late parcel", unread: false })], selected: row().id, now, empty: "Nobody" }));
    expect(out).toContain("Demo store");
    expect(out).toContain("Late parcel");
    expect(out).not.toContain('aria-label="Unread"');
    expect(out).toContain('aria-current="true"');
    expect(html(h(ConversationList, { rows: [], selected: null, now, empty: "Nobody is waiting." }))).toContain("Nobody is waiting.");
  });
});

describe("the conversation (C19)", () => {
  it("marks every author, notes and the partner as staff only, tools used, and a tone on customer messages", () => {
    const out = html(h(ConversationView, { conversation: conversation(), now }));
    expect(out).toContain('role="log"');
    expect(out).toContain("Customer");
    expect(out).toContain("Hei, har dere lamper?");
    expect(out).toContain("Tone: Bad (-30)");
    expect(out).toContain("AI assistant");
    expect(out).toContain("Used: search_products");
    expect(out).toContain("Internal note · Ola");
    expect(out).toContain("AI partner — only your team sees this");
    expect(out).toContain("Ola joined the conversation");
    // Words are drawn as text, never as markup.
    const tricky = html(h(ConversationView, { conversation: conversation({ messages: [{ ...conversation().messages[0], body: "<b>bold</b>" }] }), now }));
    expect(tricky).not.toContain("<b>bold</b>");
  });

  it("shows who it is with and where it came from", () => {
    const out = html(h(ConversationContext, { conversation: conversation() }));
    expect(out).toContain("Visitor 6F1E");
    expect(out).toContain("Demo store");
    expect(out).toContain("/s/demo/p/lamp");
    expect(out).toContain("nb-NO");
  });
});

describe("what a person may do with a conversation (step 4)", () => {
  const base = { status: "open" as const, handler: "ai" as const, assignee: null, me: "me", canWrite: true, mode: "ai_first" as const, store: { slug: "demo", name: "Demo" }, signedIn: false, source: "site" as const };

  it("offers Take over while the AI or the queue has it, and the rest once it is yours", () => {
    expect(availableActs(base)).toMatchObject({ claim: true, reply: false, note: true, handBack: false, why: null });
    expect(availableActs({ ...base, handler: "queue" }).claim).toBe(true);
    const mine = availableActs({ ...base, handler: "human", assignee: { id: "me", name: "Me" } });
    expect(mine).toMatchObject({ claim: false, reply: true, transfer: true, end: true, handBack: true, askSignIn: true });
    expect(availableActs({ ...base, handler: "human", assignee: { id: "me", name: "Me" }, mode: "people" }).handBack).toBe(false);
    expect(availableActs({ ...base, handler: "human", assignee: { id: "me", name: "Me" }, signedIn: true }).askSignIn).toBe(false);
    expect(availableActs({ ...base, handler: "human", assignee: { id: "me", name: "Me" }, store: null }).askSignIn).toBe(false);
  });

  it("says who has it, and why nothing can be done", () => {
    expect(availableActs({ ...base, handler: "human", assignee: { id: "ola", name: "Ola" } })).toMatchObject({ claim: false, reply: false, note: true, why: "Ola has this conversation." });
    expect(availableActs({ ...base, mode: "off" })).toMatchObject({ claim: false, note: true, why: expect.stringContaining("switched off") });
    expect(availableActs({ ...base, canWrite: false })).toMatchObject({ note: false, why: expect.stringContaining("not answer") });
    expect(availableActs({ ...base, status: "ended" })).toMatchObject({ claim: false, reply: false, why: "This conversation has ended." });
  });

  it("draws the buttons and a composer that says when a text is an internal note", () => {
    const feed = { ...conversation({ handler: "human", assignee: { id: "me", name: "Me" } }), me: "me", canWrite: true, mode: "ai_first" as const, agents: [{ id: "ola", name: "Ola", online: true }] };
    const out = html(h(ConversationActions, { conversation: feed, act: async () => ({ ok: true as const }), onDone: () => {} }));
    expect(out).toContain("Hand back to the AI");
    expect(out).toContain("Transfer");
    expect(out).toContain("Back to the queue");
    expect(out).toContain("Ola");
    expect(out).toContain("Ask to sign in");
    expect(out).toContain("Reply to the customer");
    expect(out).toContain("Internal note");
    const watching = html(h(ConversationActions, { conversation: { ...feed, handler: "ai", assignee: null }, act: async () => ({ ok: true as const }), onDone: () => {} }));
    expect(watching).toContain("Take over");
    expect(watching).toContain("Internal note (only your team sees it)");
    expect(watching).not.toContain("Reply to the customer");
  });
});
