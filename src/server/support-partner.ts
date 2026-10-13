import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { OWNER_TOOLS_BY_NAME, toolDefinition } from "@/lib/owner-tools";
import { toolOffered } from "@/lib/owner-tool-features";
import { PARTNER_OWNER_TOOLS, guardedForVisitor, parsePartner, partnerMayRun, partnerPrompt, partnerToolsFor, type PartnerTool } from "@/lib/support-partner";
import { AI_HISTORY, MESSAGE_MAX, PARTNER_QUESTION_MAX, PARTNER_ROUNDS } from "@/lib/support-rules";

import { AiError, aiFor, chatWithTools, type ToolChatMessage, type ToolDefinition } from "./ai";
import { siteFactsTool, type ChatSite } from "./chat-agent";
import { OwnerToolError } from "./owner-tool-error";
import { runOwnerTool } from "./owner-tools";
import { getStore } from "./stores";
import { addMessage, deskSettings, presence, SupportError } from "./support";
import type { StaffDesk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * The silent partner (D216, `docs/support.md` 2.5, step 8): the AI beside the person who has a conversation, seen only by staff. It
 * runs after each customer message (the open inbox asks 4 seconds after the last one it saw, and after a take-over) when the desk's
 * switch, the person's own and the conversation's (*Pause the partner here*) allow it and the desk has a text model; it answers once
 * per customer message, whoever asks (`support_take_partner_turn()`). An agent may also ask it a question. It reads with the agent's
 * own role through the AI manager's read-only tools (`runOwnerTool()`, so `TOOL_PERMISSIONS` and `TOOL_FEATURES` apply as there),
 * the chat's knowledge and store facts, who the customer is, and their earlier conversations; it never acts and never writes to the
 * customer. Its answer is kept as a staff-only message (author `partner`), only when `parsePartner()` reads it.
 */

export type PartnerTrigger = { kind: "message"; seq: number } | { kind: "claim" } | { kind: "question"; text: string };
export type PartnerResult = { ok: true; ran: boolean } | { ok: false; problem: string };

const RESULT_MAX = 6000;
const COULD_NOT = "The partner could not answer just now.";

const OWN_TOOLS: ToolDefinition[] = [
  {
    name: "search_content",
    description: "Search the site's pages, articles and knowledge base (delivery, returns, policies, guides) for passages that answer a question.",
    parameters: { type: "object", properties: { query: { type: "string", description: "What to look for." } }, required: ["query"] },
  },
  { name: "store_info", description: "The site's facts: name, company, contact details, countries, shipping costs and return policy.", parameters: { type: "object", properties: {} } },
  { name: "conversation_facts", description: "Who the customer is: signed in or not, their contact, language, the page they started on, and the conversation's state.", parameters: { type: "object", properties: {} } },
  { name: "earlier_conversations", description: "The same customer's earlier support conversations with this desk: their titles, outcomes and summaries.", parameters: { type: "object", properties: {} } },
];

type ConversationFacts = {
  id: string;
  status: string;
  handler: string;
  assigneeId: string | null;
  paused: boolean;
  customerId: string | null;
  requesterId: string | null;
  signedIn: boolean;
  contactName: string | null;
  contactEmail: string | null;
  customerName: string | null;
  customerEmail: string | null;
  locale: string;
  market: string | null;
  pagePath: string | null;
};

async function factsOf(staff: StaffDesk, conversationId: string): Promise<ConversationFacts | null> {
  const [row] = await db().execute<Row>(sql`
    select c.id, c.status, c.handler, c.assignee_id, c.partner_paused, c.customer_id, c.requester_id, c.contact_name, c.contact_email,
      c.locale, c.market, c.page_path, cu.name as customer_name, cu.email as customer_email
    from commerce.support_conversations c
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    where c.id = ${conversationId}::uuid and c.store_id is not distinct from ${staff.desk.storeId}::uuid and c.anonymised_at is null
  `);
  if (!row) return null;
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  return {
    id: String(row.id),
    status: String(row.status),
    handler: String(row.handler),
    assigneeId: text(row.assignee_id),
    paused: Boolean(row.partner_paused),
    customerId: text(row.customer_id),
    requesterId: text(row.requester_id),
    signedIn: row.customer_id !== null,
    contactName: text(row.contact_name),
    contactEmail: text(row.contact_email),
    customerName: text(row.customer_name),
    customerEmail: text(row.customer_email),
    locale: String(row.locale),
    market: text(row.market),
    pagePath: text(row.page_path),
  };
}

/** The conversation's messages the partner reads: the customer's, the AI's and people's (never notes or its own), oldest first. */
async function history(staff: StaffDesk, conversationId: string): Promise<{ author: string; body: string }[]> {
  const rows = await db().execute<Row>(sql`
    select author, body from commerce.support_messages
    where conversation_id = ${conversationId}::uuid and store_id is not distinct from ${staff.desk.storeId}::uuid and author in ('customer', 'ai', 'agent')
    order by seq desc limit ${AI_HISTORY}
  `);
  return rows.reverse().map((r) => ({ author: String(r.author), body: String(r.body) }));
}

const LANGUAGES: Record<string, string> = { nb: "Norwegian", no: "Norwegian", nn: "Norwegian", sv: "Swedish", da: "Danish", en: "English", de: "German", fi: "Finnish" };

/** Runs the partner for a person of the desk; see the module's note. */
export async function runPartner(staff: StaffDesk, conversationId: string, trigger: PartnerTrigger): Promise<PartnerResult> {
  if (!staff.canWrite) return { ok: false, problem: "You can read this desk's conversations but not answer them." };
  const facts = await factsOf(staff, conversationId);
  if (!facts) return { ok: false, problem: "This conversation is no longer here." };
  const settings = await deskSettings(staff.desk);
  if (!settings) return { ok: false, problem: "This conversation is no longer here." };
  const connection = await aiFor(staff.desk.storeId, { feature: "support_partner", accountId: staff.account.id });
  const hasModel = Boolean(connection?.textModel);
  const me = staff.account.id;

  if (trigger.kind === "question") {
    if (settings.mode === "off" || !settings.partner) return { ok: false, problem: "The silent partner is off for this desk." };
    if (!hasModel) return { ok: false, problem: "The silent partner needs a text model in the AI settings." };
    if (facts.status !== "open") return { ok: false, problem: "This conversation has ended." };
  } else {
    const mine = await presence(staff.desk, me);
    const may = partnerMayRun({
      mode: settings.mode,
      deskPartner: settings.partner,
      agentPartner: mine.partner,
      paused: facts.paused,
      hasModel,
      handler: facts.handler as "ai" | "queue" | "human",
      assigneeIsAgent: facts.assigneeId === me,
    });
    if (!may) return { ok: true, ran: false };
    const seq = trigger.kind === "message" ? trigger.seq : await lastCustomerSeq(conversationId);
    if (!seq) return { ok: true, ran: false };
    // Once per customer message, whoever asks: the first caller takes the turn.
    const [taken] = await db().execute<Row>(sql`select commerce.support_take_partner_turn(${conversationId}::uuid, ${seq}) as won`);
    if (!taken?.won) return { ok: true, ran: false };
  }

  // The tools: the AI manager's read-only ones the agent's role may use in a store (and whose features are on), and the partner's own.
  const store = staff.store ? await getStore(staff.store.slug) : null;
  if (staff.store && !store) return { ok: false, problem: "This conversation is no longer here." };
  const allowed: PartnerTool[] = store && staff.holder ? partnerToolsFor(staff.holder).filter((name) => !(PARTNER_OWNER_TOOLS as readonly string[]).includes(name) || toolOffered(store, name)) : [];
  const tools: ToolDefinition[] = [...allowed.filter((name) => OWNER_TOOLS_BY_NAME[name]).map((name) => toolDefinition(OWNER_TOOLS_BY_NAME[name])), ...OWN_TOOLS];
  const site: ChatSite | null = store
    ? { kind: "store", store, market: store.markets.find((m) => m.slug === facts.market) ?? store.markets[0] }
    : staff.store
      ? null
      : { kind: "kaizen" };

  const lines = await history(staff, conversationId);
  const transcript = lines.map((l) => `${l.author === "customer" ? "Customer" : l.author === "ai" ? "Assistant (AI)" : "Staff"}: ${l.body.replace(/\s+/g, " ").slice(0, 1000)}`).join("\n");
  const question = trigger.kind === "question" ? trigger.text.trim().slice(0, PARTNER_QUESTION_MAX) : null;
  const agentName = staff.account.name?.split(/\s+/)[0] || "the agent";
  const messages: ToolChatMessage[] = [
    {
      role: "system",
      content: partnerPrompt({ agent: agentName, desk: staff.store?.name ?? "Kaizen", signedIn: facts.signedIn, language: LANGUAGES[facts.locale.split("-")[0]] ?? "the customer's language", question: question !== null }),
    },
    { role: "user", content: `${transcript || "(No messages yet.)"}${question ? `\n\nThe agent asks: ${question}` : ""}` },
  ];

  const called: string[] = [];
  let content: string | null = null;
  try {
    for (let round = 0; round <= PARTNER_ROUNDS; round++) {
      const step = await chatWithTools(connection!, messages, round < PARTNER_ROUNDS ? tools : [], { maxTokens: 900 });
      if (step.toolCalls.length === 0 || round === PARTNER_ROUNDS) {
        content = step.content;
        break;
      }
      messages.push({ role: "assistant", content: step.content, tool_calls: step.toolCalls });
      for (const call of step.toolCalls.slice(0, 4)) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          // The tool says what it needs.
        }
        const result = await runTool(staff, store, site, facts, allowed, name, args);
        if (!("error" in result)) called.push(name);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, RESULT_MAX) });
      }
      for (const call of step.toolCalls.slice(4)) messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Too many tools at once." }) });
    }
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: COULD_NOT };
    throw error;
  }

  const parsed = content ? parsePartner(content, called) : null;
  if (!parsed) return { ok: false, problem: COULD_NOT };
  const answer = guardedForVisitor(parsed, facts.signedIn, called);
  const body = (answer.answer ?? answer.recommendation ?? answer.facts[0]?.text ?? answer.draft ?? "").slice(0, MESSAGE_MAX.partner);
  try {
    await addMessage(staff.desk, conversationId, "partner", me, body, {
      kind: question ? "answer" : "suggestion",
      data: { ...answer, question, signedIn: facts.signedIn },
    });
  } catch (error) {
    // Ended in the meantime: nothing is kept.
    if (error instanceof SupportError) return { ok: false, problem: "This conversation has ended." };
    throw error;
  }
  return { ok: true, ran: true };
}

async function lastCustomerSeq(conversationId: string): Promise<number | null> {
  const [row] = await db().execute<Row>(sql`select max(seq) as seq from commerce.support_messages where conversation_id = ${conversationId}::uuid and author = 'customer'`);
  return row?.seq ? Number(row.seq) : null;
}

async function runTool(
  staff: StaffDesk,
  store: Awaited<ReturnType<typeof getStore>>,
  site: ChatSite | null,
  facts: ConversationFacts,
  allowed: readonly string[],
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case "search_content":
      case "store_info":
        if (!site) return { error: "Not available." };
        return JSON.parse(await siteFactsTool(site, name, name === "search_content" ? { query: String(args.query ?? "") } : {})) as Record<string, unknown>;
      case "conversation_facts":
        return {
          signedIn: facts.signedIn,
          ...(facts.signedIn ? { customer: { name: facts.customerName, email: facts.customerEmail } } : { contact: { name: facts.contactName, email: facts.contactEmail, note: "Typed in the chat: not proof of who they are." } }),
          language: facts.locale,
          market: facts.market,
          startedOn: facts.pagePath,
          state: facts.status === "open" ? facts.handler : "ended",
        };
      case "earlier_conversations":
        return { conversations: await earlier(staff, facts) };
      default: {
        // Only the AI manager's read-only tools this agent's role may use: never a gated or writing tool (`PARTNER_OWNER_TOOLS`).
        if (!store || !allowed.includes(name) || !OWNER_TOOLS_BY_NAME[name]) return { error: "That tool is not yours to use here." };
        const result = await runOwnerTool({ account: staff.account, store, invalidate: () => {}, holder: staff.holder ?? undefined }, name, args);
        return { result };
      }
    }
  } catch (error) {
    if (error instanceof OwnerToolError) return { error: error.message };
    console.warn(`[support] partner tool ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return { error: "That did not work just now." };
  }
}

/** The same customer's (or the same account's, on Kaizen's desk) earlier conversations: titles, outcomes and summaries, newest first. */
async function earlier(staff: StaffDesk, facts: ConversationFacts) {
  const who = facts.customerId ? sql`c.customer_id = ${facts.customerId}::uuid` : facts.requesterId ? sql`c.requester_id = ${facts.requesterId}::uuid` : null;
  if (!who) return [];
  const rows = await db().execute<Row>(sql`
    select c.created_at, c.summary from commerce.support_conversations c
    where c.store_id is not distinct from ${staff.desk.storeId}::uuid and ${who} and c.id <> ${facts.id}::uuid and c.anonymised_at is null
    order by c.created_at desc limit 5
  `);
  return rows.map((r) => {
    const summary = r.summary as { title?: unknown; outcome?: unknown; text?: unknown } | null;
    return {
      started: new Date(String(r.created_at)).toISOString().slice(0, 10),
      title: summary?.title ?? null,
      outcome: summary?.outcome ?? null,
      summary: summary?.text ?? null,
    };
  });
}
