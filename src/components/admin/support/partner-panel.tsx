"use client";

import { useState } from "react";

import { PARTNER_QUESTION_MAX } from "@/lib/support-rules";
import type { ConversationFeed } from "@/server/support-inbox";

import type { ActResult } from "./desk-context";

/** A partner message's data as the server keeps it (step 8). */
type PartnerData = {
  facts?: { text: string; tool: string }[];
  recommendation?: string | null;
  draft?: string | null;
  answer?: string | null;
  question?: string | null;
};

/** The words for a tool the partner read, so a fact says where it came from in the admin's words. */
const TOOL_WORDS: Record<string, string> = {
  get_order: "the order",
  list_orders: "the orders",
  list_returns: "returns",
  explain_return: "a return",
  list_subscriptions: "subscriptions",
  subscription_boxes: "subscription boxes",
  list_emails: "emails sent",
  list_invoices: "invoices",
  list_bookings: "bookings",
  get_customer: "the customer",
  list_customers: "customers",
  list_products: "products",
  get_product: "a product",
  stock_levels: "stock",
  list_discounts: "discount codes",
  list_campaigns: "campaigns",
  get_bonus_program: "the bonus program",
  search_content: "the site's pages",
  store_info: "the store's details",
  conversation_facts: "this conversation",
  earlier_conversations: "earlier conversations",
};

/**
 * The silent partner's tab (D216, `docs/support.md` 2.5, step 8): the brief, then the partner's cards newest first (facts with where
 * each came from, a recommendation, a draft with *Use*, an answer to a question), *Ask the partner*, and *Pause the partner here* for
 * the person who has the conversation. Marked as staff only throughout; *Use* only fills the composer, it sends nothing.
 */
export function PartnerPanel({
  conversation,
  act,
  onDone,
  onUse,
  working,
}: {
  conversation: ConversationFeed;
  act: (input: unknown) => Promise<ActResult>;
  onDone: () => void;
  onUse: (text: string) => void;
  /** The partner is looking after a customer message. */
  working: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cards = conversation.messages.filter((m) => m.author === "partner").slice().reverse();
  const mine = conversation.status === "open" && conversation.handler === "human" && conversation.assignee?.id === conversation.me;

  async function run(input: unknown, after?: () => void) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await act(input);
      if (!result.ok) setProblem(result.problem);
      else {
        after?.();
        onDone();
      }
    } catch {
      setProblem("The partner could not answer just now.");
    } finally {
      setBusy(false);
    }
  }

  if (!conversation.partner.available) {
    return <p className="p-4 text-sm text-muted">The silent partner is off for this desk, or the desk has no text model. It is set in the support settings.</p>;
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-sm" aria-busy={busy || working || undefined}>
      <p className="text-xs font-medium">AI partner — only your team sees this</p>
      {!conversation.signedIn && conversation.store && (
        <p className="rounded-md border border-dashed border-line p-2 text-xs">Not signed in: what the customer says about an order is not proven.</p>
      )}
      {conversation.brief && (
        <section className="rounded-md border border-dashed border-line p-2">
          <p className="text-xs text-muted">So far</p>
          <p>{conversation.brief.text}</p>
        </section>
      )}
      {!conversation.partner.mine && <p className="text-xs text-muted">Your partner is off: it does not look by itself. Turn it on in the inbox&apos;s header, or ask it below.</p>}
      {mine && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={conversation.partnerPaused}
            disabled={busy}
            onChange={(event) => void run({ kind: "pause_partner", paused: event.target.checked })}
            className="size-4"
          />
          Pause the partner here
        </label>
      )}
      {working && <p role="status" className="text-xs text-muted">The partner is looking…</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = question.trim();
          if (text) void run({ kind: "ask_partner", question: text }, () => setQuestion(""));
        }}
        className="flex flex-col gap-1"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs">Ask the partner</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={2}
            maxLength={PARTNER_QUESTION_MAX}
            placeholder="Has this customer ordered before?"
            className="rounded-md border border-dashed border-line bg-card px-2 py-1.5"
          />
        </label>
        <button type="submit" disabled={busy || !question.trim() || conversation.status !== "open"} className="self-end rounded-md border border-edge px-2 py-1 text-xs hover:bg-sunken disabled:opacity-50">
          Ask
        </button>
      </form>
      {problem && (
        <p role="alert" className="text-xs">
          {problem}
        </p>
      )}
      {cards.length === 0 && !working && <p className="text-xs text-muted">Nothing yet. The partner looks after each customer message once you have the conversation.</p>}
      <ol className="flex flex-col gap-3">
        {cards.map((card) => {
          const data = (card.data ?? {}) as PartnerData;
          return (
            <li key={card.seq} className="flex flex-col gap-2 rounded-md border border-dashed border-line p-2" data-author="partner">
              {data.question && <p className="text-xs text-muted">You asked: {data.question}</p>}
              {data.answer && <p>{data.answer}</p>}
              {data.facts && data.facts.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {data.facts.map((fact, i) => (
                    <li key={i}>
                      {fact.text} <span className="text-xs text-muted">(from {TOOL_WORDS[fact.tool] ?? fact.tool})</span>
                    </li>
                  ))}
                </ul>
              )}
              {data.recommendation && (
                <p>
                  <span className="font-medium">Next: </span>
                  {data.recommendation}
                </p>
              )}
              {data.draft && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted">A reply you could send</p>
                  <p className="whitespace-pre-line rounded bg-sunken p-2">{data.draft}</p>
                  {mine && (
                    <button type="button" onClick={() => onUse(data.draft!)} className="self-start rounded-md border border-edge px-2 py-1 text-xs hover:bg-sunken">
                      Use
                    </button>
                  )}
                </div>
              )}
              <time dateTime={card.at} className="text-xs text-muted">
                {card.at.slice(11, 16)}
              </time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
