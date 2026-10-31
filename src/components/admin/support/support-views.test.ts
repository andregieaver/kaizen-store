import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { agoWords, handlerWords, systemWords, toneWords } from "@/lib/support-inbox-text";
import type { InboxRow, StaffConversation } from "@/server/support";

import { availableActs, ConversationActions } from "./conversation-actions";
import { ConversationList } from "./conversation-list";
import { ConversationContext, ConversationView, SummaryPanel } from "./conversation-view";
import { conversationHref } from "./desk-context";
import { PartnerPanel } from "./partner-panel";
import { SupportSettingsForm } from "./settings-form";

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
  toneAlert: false,
  outcome: null,
  topics: [],
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
  ratingComment: null,
  summaryStatus: "none",
  brief: null,
  partnerSeq: 0,
  partnerPaused: false,
  messageSeq: 5,
  toneMeasured: true,
  toneAlertAt: null,
  addressCustomer: null,
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
    const feed = { ...conversation({ handler: "human", assignee: { id: "me", name: "Me" } }), me: "me", canWrite: true, mode: "ai_first" as const, agents: [{ id: "ola", name: "Ola", online: true }], partner: { available: true, mine: true }, channel: "", translate: false };
    const out = html(h(ConversationActions, { conversation: feed, act: async () => ({ ok: true as const }), onDone: () => {} }));
    expect(out).toContain("Hand back to the AI");
    expect(out).toContain("Transfer");
    expect(out).toContain("Back to the queue");
    expect(out).toContain("Ola");
    expect(out).toContain("Ask to sign in");
    expect(out).toContain("Reply to the customer");
    expect(out).toContain("Internal note");
    // With the AI (or waiting): the box answers the customer, and says sending takes the conversation over; a note is one step away.
    const watching = html(h(ConversationActions, { conversation: { ...feed, handler: "ai", assignee: null }, act: async () => ({ ok: true as const }), onDone: () => {} }));
    expect(watching).toContain("Take over");
    expect(watching).toContain("Reply to the customer");
    expect(watching).toContain("Sending takes the conversation over");
    expect(watching).toContain("Internal note");
    // Someone else's: only a note, never an answer over their head.
    const theirs = html(h(ConversationActions, { conversation: { ...feed, handler: "human", assignee: { id: "ola", name: "Ola" } }, act: async () => ({ ok: true as const }), onDone: () => {} }));
    expect(theirs).not.toContain("Take over");
    expect(theirs).not.toContain("Reply to the customer");
    expect(theirs).toContain("Internal note (only your team sees it)");
  });
});

describe("the desk's settings (step 5)", () => {
  const settings = {
    mode: "ai_first" as const,
    transcriptDays: 90,
    endAfterMinutes: 30,
    emailFollowup: true,
    channelKey: "k",
    agentNaming: "first_name" as const,
    hours: null,
    notifyAfterMinutes: 5,
    toneOn: true,
    toneAlert: -40,
    toneHandoff: -60,
    summariesOn: true,
    sensitive: false,
    partner: true,
    aiActions: null,
    formMessages: "inbox_and_email" as const,
    aiReady: false,
  };
  const form = (over: Partial<Parameters<typeof SupportSettingsForm>[0]> = {}) =>
    html(
      h(SupportSettingsForm, {
        settings,
        save: null,
        canWrite: true,
        owner: true,
        deskName: "Demo store",
        aiSettingsHref: "/admin/demo/settings/ai",
        chatHref: "/admin/demo/chat",
        openCount: 0,
        ...over,
      }),
    );

  it("offers the three choices of who answers, and says plainly when the AI first has no AI", () => {
    const out = form();
    expect(out).toContain("Support off — the chat assistant alone");
    expect(out).toContain("The AI first, then your team");
    expect(out).toContain("Your team only");
    expect(out).toContain("No AI is connected: your customers will reach your team only");
    expect(form({ settings: { ...settings, aiReady: true } })).not.toContain("No AI is connected");
  });

  it("lets only the owner change how long transcripts are kept", () => {
    expect(form({ owner: false })).toContain("(only the owner changes this)");
    expect(form()).not.toContain("only the owner changes this");
  });
});

describe("summaries, briefs and ratings (step 7)", () => {
  const ended = (over: Partial<StaffConversation> = {}) =>
    conversation({ status: "ended", endedAt: "2026-10-13T12:02:00Z", startedAt: "2026-10-13T11:50:00Z", summaryStatus: "done", ...over });

  it("marks a summary as the AI's, with its outcome, topics, follow-up, how long it lasted and the customer's rating", () => {
    const out = html(
      h(SummaryPanel, {
        conversation: ended({
          summary: { title: "Late parcel", text: "The parcel was late; it ships today.", outcome: "follow_up", topics: ["delivery", "order_status"], followUp: "Check it arrived.", edited: false },
          rating: "good",
          ratingComment: "Quick help",
        }),
      }),
    );
    expect(out).toContain("Summary · Written by AI");
    expect(out).toContain("Late parcel");
    expect(out).toContain("Needs a follow-up");
    expect(out).toContain("Order status");
    expect(out).toContain("To do: Check it arrived.");
    expect(out).toContain("Lasted 12 min");
    expect(out).toContain("The customer said we helped");
    expect(out).toContain("Quick help");
  });

  it("says why there is no summary, never inventing one, and shows a brief while open", () => {
    expect(html(h(SummaryPanel, { conversation: ended({ summary: null, summaryStatus: "skipped" }) }))).toContain("No AI summary");
    expect(html(h(SummaryPanel, { conversation: ended({ summary: null, summaryStatus: "pending" }) }))).toContain("The AI is writing a summary.");
    expect(html(h(SummaryPanel, { conversation: ended({ summary: null, summaryStatus: "failed" }) }))).toContain("could not write a summary");
    expect(html(h(SummaryPanel, { conversation: conversation({ brief: { text: "Wants a refund.", seq: 4 } }) }))).toContain("So far · Written by AI");
    expect(html(h(SummaryPanel, { conversation: conversation() }))).toBe("");
  });

  it("offers a brief while open and correcting the summary once ended", () => {
    const base = { status: "open" as const, handler: "ai" as const, assignee: null, me: "me", canWrite: true, mode: "ai_first" as const, store: { slug: "demo", name: "Demo" }, signedIn: false, source: "site" as const };
    expect(availableActs(base)).toMatchObject({ brief: true, editSummary: false });
    expect(availableActs({ ...base, status: "ended" })).toMatchObject({ brief: false, editSummary: true });
    expect(availableActs({ ...base, status: "ended", canWrite: false })).toMatchObject({ editSummary: false });
  });
});

describe("the silent partner's tab (step 8, C24)", () => {
  const feed = (over: Partial<StaffConversation> = {}, partner = { available: true, mine: true }) => ({
    ...conversation({
      handler: "human",
      assignee: { id: "me", name: "Me" },
      messages: [
        { seq: 1, author: "customer", body: "Where is order 1042?", kind: null, data: null, by: null, tone: null, toneLabel: null, tools: [], at: "2026-10-13T11:50:00Z" },
        {
          seq: 2,
          author: "partner",
          body: "Sent yesterday.",
          kind: "suggestion",
          data: { facts: [{ text: "Order 1042 was sent with Bring", tool: "get_order" }], recommendation: "Share the tracking.", draft: "It was sent yesterday with Bring.", answer: null },
          by: null,
          tone: null,
          toneLabel: null,
          tools: [],
          at: "2026-10-13T11:50:06Z",
        },
      ],
      ...over,
    }),
    me: "me",
    canWrite: true,
    mode: "ai_first" as const,
    agents: [],
    partner,
    channel: "",
    translate: false,
  });
  const panel = (f: ReturnType<typeof feed>, working = false) => html(h(PartnerPanel, { conversation: f, act: async () => ({ ok: true as const }), onDone: () => {}, onUse: () => {}, working }));

  it("shows facts with where they came from, the recommendation and a draft to use, marked as staff only", () => {
    const out = panel(feed());
    expect(out).toContain("AI partner — only your team sees this");
    expect(out).toContain("Order 1042 was sent with Bring");
    expect(out).toContain("(from the order)");
    expect(out).toContain("Share the tracking.");
    expect(out).toContain("It was sent yesterday with Bring.");
    expect(out).toContain(">Use<");
    expect(out).toContain("Pause the partner here");
    expect(out).toContain("Not signed in: what the customer says about an order is not proven.");
  });

  it("offers no Use to someone who does not have the conversation, says when it is off, and when it is looking", () => {
    expect(panel(feed({ assignee: { id: "ola", name: "Ola" } }))).not.toContain(">Use<");
    expect(panel(feed({}, { available: false, mine: true }))).toContain("The silent partner is off for this desk");
    expect(panel(feed({}, { available: true, mine: false }))).toContain("Your partner is off");
    expect(panel(feed(), true)).toContain("The partner is looking");
  });
});
