import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition, type GateCategory } from "@/lib/owner-tools";

import { AiError, aiFor, canSpeak, streamWithTools, type AiConnection, type ToolChatMessage } from "./ai";
import type { Membership } from "./auth";
import { OwnerToolError, runOwnerTool, type OwnerToolContext } from "./owner-tools";

type Row = Record<string, unknown>;

/**
 * The owner assistant (D94): a store owner's own assistant in the admin,
 * modelled on Kaizen Life's. It runs a tool loop with the store's AI (D73)
 * over the store's own reads and writes (`src/lib/owner-tools.ts`), keeps
 * the conversation, and stops at the approval gate: a call that sends,
 * publishes or spends is kept and runs only when the owner says yes. It
 * works on its own; Kaizen Life is never needed.
 */

/** Rounds of tools before the model must answer. */
const MAX_STEPS = 10;
/** Earlier turns the model is given, as text. */
const HISTORY = 20;
/** What the owner may send the assistant in a day, per store. */
export const DAILY_TURNS = 300;
/** A tool's answer is cut to this, keeping the model's context. */
const RESULT_MAX = 12_000;

export type ToolTrail = { name: string; ok: boolean };
export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; tools: ToolTrail[]; createdAt: string };
export type Approval = {
  id: string;
  tool: string;
  summary: string;
  category: GateCategory;
  status: "pending" | "done" | "declined" | "failed";
  outcome: string | null;
  createdAt: string;
};
export type Conversation = { id: string; title: string; messages: AssistantMessage[]; approvals: Approval[] };
export type ConversationSummary = { id: string; title: string; updatedAt: string };

export type AssistantEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  /** The text streamed this round led to tools, so it was a preface: drop it. */
  | { type: "round"; tools: string[] }
  | { type: "approval"; approval: Approval }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; message: string };

export type AssistantAbilities = { text: boolean; hear: boolean; speak: boolean };

export async function assistantAbilities(storeId: string): Promise<AssistantAbilities> {
  const connection = await aiFor(storeId);
  return { text: Boolean(connection?.textModel), hear: Boolean(connection?.transcriptionModel), speak: canSpeak(connection) };
}

// Conversations -------------------------------------------------------------------

const toMessage = (row: Row): AssistantMessage => ({
  id: String(row.id),
  role: row.role === "user" ? "user" : "assistant",
  content: String(row.content),
  tools: (row.tools as ToolTrail[] | null) ?? [],
  createdAt: new Date(String(row.created_at)).toISOString(),
});

const toApproval = (row: Row): Approval => {
  const result = row.result as { done?: string; error?: string } | null;
  return {
    id: String(row.id),
    tool: String(row.tool),
    summary: String(row.summary),
    category: row.category as GateCategory,
    status: row.status as Approval["status"],
    outcome: result?.done ?? result?.error ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
};

export async function listConversations({ store, account }: Membership): Promise<ConversationSummary[]> {
  const rows = await db().execute<Row>(sql`
    select id, title, updated_at from commerce.assistant_conversations
    where store_id = ${store.id}::uuid and account_id = ${account.id}::uuid
    order by updated_at desc limit 50
  `);
  return rows.map((row) => ({ id: String(row.id), title: String(row.title), updatedAt: new Date(String(row.updated_at)).toISOString() }));
}

export async function getConversation({ store, account }: Membership, id: string): Promise<Conversation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [conversation] = await db().execute<Row>(sql`
    select id, title from commerce.assistant_conversations
    where id = ${id}::uuid and store_id = ${store.id}::uuid and account_id = ${account.id}::uuid
  `);
  if (!conversation) return null;
  const [messages, approvals] = await Promise.all([
    db().execute<Row>(sql`select * from commerce.assistant_messages where conversation_id = ${id}::uuid order by created_at, id`),
    db().execute<Row>(sql`select * from commerce.assistant_approvals where conversation_id = ${id}::uuid order by created_at, id`),
  ]);
  return { id, title: String(conversation.title), messages: messages.map(toMessage), approvals: approvals.map(toApproval) };
}

export async function deleteConversation({ store, account }: Membership, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db().execute(sql`
    delete from commerce.assistant_conversations
    where id = ${id}::uuid and store_id = ${store.id}::uuid and account_id = ${account.id}::uuid returning 1
  `);
  return rows.length > 0;
}

async function addMessage(storeId: string, conversationId: string, role: "user" | "assistant", content: string, tools: ToolTrail[] = []) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_messages (store_id, conversation_id, role, content, tools)
    values (${storeId}::uuid, ${conversationId}::uuid, ${role}, ${content.slice(0, 20_000)}, ${JSON.stringify(tools)}::jsonb)
    returning *
  `);
  await db().execute(sql`update commerce.assistant_conversations set updated_at = now() where id = ${conversationId}::uuid`);
  return toMessage(row);
}

// The prompt ------------------------------------------------------------------------

export function assistantPrompt(member: Membership, now = new Date()): string {
  const { store, account } = member;
  const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: store.timeZone }).format(now);
  const countries = store.markets.map((m) => `${m.name} (${m.currency}, ${m.lang})`).join(", ");
  return [
    `You are the assistant of ${store.name}, an online store on Kaizen, working for its owner${account.name ? `, ${account.name}` : ""}, in the store's admin.`,
    `It is ${today} in the store's time zone (${store.timeZone}). The store sells in ${countries || "no countries yet"}.`,
    "",
    "How you work:",
    "- Everything you say about the store comes from your tools, in this turn or earlier ones. Never guess or invent orders, products, prices, stock, customers or totals.",
    "- Amounts come written out by the tools: repeat them as given. Never add up, average or convert amounts yourself: sales_summary does the sums.",
    "- Look things up before acting on them, so you use real order numbers, products and ids.",
    "- Changes that send something in the store's name, change what the site shows or cost money are not made by you: your call is kept for the owner to approve, with a button under your answer. Say plainly what is waiting for their yes. Never say it is done before it is.",
    "- Notes on orders and reading anything are fine without asking.",
    "- If a tool refuses or fails, say what it said. If no tool can do what is asked, say so and point to the admin page that can.",
    "- Answer in the language the owner writes in. Keep answers short and concrete, in plain text: short lines or simple lists, no tables and no HTML.",
  ].join("\n");
}

// A turn ---------------------------------------------------------------------------------

export type TurnInput = {
  member: Membership;
  conversationId: string | null;
  message: string;
  emit: (event: AssistantEvent) => void;
  invalidate: (tag: string) => void;
  signal?: AbortSignal;
  /** The connection to use; the store's own (D73) unless given (tests). */
  connection?: AiConnection | null;
};

/** Counts today's turns for the store; past the limit, the reason to give. */
async function overLimit(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.assistant_messages
    where store_id = ${storeId}::uuid and role = 'user' and created_at > now() - interval '1 day'
  `);
  return Number(row.n) >= DAILY_TURNS;
}

/**
 * The owner's message, answered: kept, run through the tool loop with the
 * conversation so far, and the answer kept. Events stream as it goes.
 */
export async function runTurn(input: TurnInput): Promise<void> {
  const { member, emit } = input;
  const { store } = member;
  const text = input.message.trim().slice(0, 4000);
  if (!text) return emit({ type: "error", message: "Write something first." });
  const connection = input.connection === undefined ? await aiFor(store.id) : input.connection;
  if (!connection?.textModel) {
    return emit({ type: "error", message: "The assistant needs a text model: set one up under Settings → AI." });
  }
  if (await overLimit(store.id)) return emit({ type: "error", message: `The assistant has answered ${DAILY_TURNS} messages for this store today. It is back tomorrow.` });

  let conversationId = input.conversationId;
  if (conversationId && !(await getConversation(member, conversationId))) conversationId = null;
  if (!conversationId) {
    const title = text.replace(/\s+/g, " ").slice(0, 80);
    const [row] = await db().execute<Row>(sql`
      insert into commerce.assistant_conversations (store_id, account_id, title)
      values (${store.id}::uuid, ${member.account.id}::uuid, ${title}) returning id
    `);
    conversationId = String(row.id);
    emit({ type: "conversation", id: conversationId, title });
  }
  const history = await db().execute<Row>(sql`
    select role, content from (
      select role, content, created_at, id from commerce.assistant_messages
      where conversation_id = ${conversationId}::uuid order by created_at desc, id desc limit ${HISTORY}
    ) recent order by created_at, id
  `);
  await addMessage(store.id, conversationId, "user", text);

  const ctx: OwnerToolContext = { account: member.account, store, invalidate: input.invalidate };
  const tools = OWNER_TOOLS.map(toolDefinition);
  const messages: ToolChatMessage[] = [
    { role: "system", content: assistantPrompt(member) },
    ...history.map((row) => ({ role: row.role === "user" ? ("user" as const) : ("assistant" as const), content: String(row.content) })),
    { role: "user", content: text },
  ];
  const trail: ToolTrail[] = [];
  let reply = "";
  try {
    for (let step = 0; step <= MAX_STEPS; step++) {
      if (input.signal?.aborted) throw new AiError("Stopped.");
      const last = step === MAX_STEPS;
      const answer = await streamWithTools(connection, messages, last ? [] : tools, (delta) => emit({ type: "text", delta }), {
        signal: input.signal,
      });
      if (answer.toolCalls.length === 0 || last) {
        reply = answer.content ?? "";
        break;
      }
      emit({ type: "round", tools: answer.toolCalls.map((call) => call.function.name) });
      messages.push({ role: "assistant", content: answer.content, tool_calls: answer.toolCalls });
      for (const call of answer.toolCalls) {
        if (input.signal?.aborted) throw new AiError("Stopped.");
        const result = await callTool(ctx, conversationId, call.function.name, call.function.arguments, emit);
        trail.push({ name: call.function.name, ok: !("error" in result) });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, RESULT_MAX) });
      }
    }
  } catch (error) {
    const message = error instanceof AiError ? `The store's AI did not answer: ${error.message}` : "Something went wrong. Try again.";
    if (!(error instanceof AiError)) console.error("[owner-assistant]", error);
    const saved = await addMessage(store.id, conversationId, "assistant", message, trail);
    emit({ type: "error", message });
    emit({ type: "done", message: saved });
    return;
  }
  const saved = await addMessage(store.id, conversationId, "assistant", reply.trim() || "(No answer.)", trail);
  emit({ type: "done", message: saved });
}

/** One tool call: run, or kept for approval if it is gated; its answer (or error) for the model. */
async function callTool(
  ctx: OwnerToolContext,
  conversationId: string,
  name: string,
  rawArgs: string,
  emit: (event: AssistantEvent) => void,
): Promise<Record<string, unknown>> {
  let args: unknown;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { error: "The arguments were not valid JSON." };
  }
  const tool = OWNER_TOOLS_BY_NAME[name];
  if (!tool) return { error: `There is no tool called ${name}.` };
  if (tool.gate) {
    const input = readToolInput(tool, args);
    if (!input.ok) return { error: `The arguments could not be read: ${input.problem}` };
    const approval = await queueApproval(ctx, conversationId, name, tool.gate, input.input as Record<string, unknown>);
    emit({ type: "approval", approval });
    return {
      queued_for_approval: true,
      what: approval.summary,
      note: "Not done yet: the owner approves or declines it with the button under your answer. Tell them it is waiting.",
    };
  }
  try {
    return { result: await runOwnerTool(ctx, name, args) };
  } catch (error) {
    if (error instanceof OwnerToolError) return { error: error.message };
    console.error(`[owner-assistant] ${name}`, error);
    return { error: "The tool failed." };
  }
}

/** A gated call kept for the owner's yes, described in words made from its arguments and the store's data. */
async function queueApproval(ctx: OwnerToolContext, conversationId: string, tool: string, category: GateCategory, args: Record<string, unknown>) {
  let summary = approvalSummary(tool, args);
  if (tool === "cancel_booking") {
    const [booking] = await db().execute<Row>(sql`
      select b.starts_at, coalesce((select t.title from commerce.product_translations t where t.product_id = b.product_id order by t.locale limit 1), '') as service,
        coalesce(nullif(o.billing_address ->> 'name', ''), o.email, '') as customer
      from commerce.bookings b left join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
      where b.store_id = ${ctx.store.id}::uuid and b.id = ${String(args.booking)}::uuid
    `);
    if (booking) {
      const when = new Intl.DateTimeFormat(ctx.store.markets[0]?.locale ?? "en", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.store.timeZone }).format(
        new Date(String(booking.starts_at)),
      );
      summary = `Cancel ${booking.service} on ${when}${booking.customer ? ` for ${booking.customer}` : ""}${args.notify === false ? "" : ", and email the customer"}.`;
    }
  }
  if (tool === "unpublish_page") {
    const [page] = await db().execute<Row>(sql`
      select published ->> 'title' as title from commerce.pages where store_id = ${ctx.store.id}::uuid and id = ${String(args.page)}::uuid
    `);
    if (page?.title) summary = `Take "${page.title}" off the site, keeping its draft.`;
  }
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_approvals (store_id, conversation_id, account_id, tool, args, summary, category)
    values (${ctx.store.id}::uuid, ${conversationId}::uuid, ${ctx.account.id}::uuid, ${tool}, ${JSON.stringify(args)}::jsonb, ${summary}, ${category})
    returning *
  `);
  return toApproval(row);
}

/**
 * The owner's answer to a kept call: yes runs exactly the call that was
 * kept, once (the row is claimed first); no declines it. Either way the
 * conversation says what happened.
 */
export async function decideApproval(
  member: Membership,
  approvalId: string,
  approve: boolean,
  invalidate: (tag: string) => void,
): Promise<Approval | null> {
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return null;
  const [claimed] = await db().execute<Row>(sql`
    update commerce.assistant_approvals set status = ${approve ? "done" : "declined"}, decided_at = now()
    where id = ${approvalId}::uuid and store_id = ${member.store.id}::uuid and account_id = ${member.account.id}::uuid and status = 'pending'
    returning *
  `);
  if (!claimed) return null;
  const conversationId = String(claimed.conversation_id);
  if (!approve) {
    await addMessage(member.store.id, conversationId, "assistant", `Declined: ${claimed.summary}`);
    return toApproval(claimed);
  }
  let result: { done?: string; error?: string };
  try {
    const answer = (await runOwnerTool({ account: member.account, store: member.store, invalidate }, String(claimed.tool), claimed.args)) as { done?: string };
    result = { done: answer?.done ?? "Done." };
  } catch (error) {
    result = { error: error instanceof OwnerToolError ? error.message : "It could not be done." };
    if (!(error instanceof OwnerToolError)) console.error("[owner-assistant] approval", error);
  }
  const [row] = await db().execute<Row>(sql`
    update commerce.assistant_approvals set status = ${result.error ? "failed" : "done"}, result = ${JSON.stringify(result)}::jsonb
    where id = ${approvalId}::uuid returning *
  `);
  await addMessage(member.store.id, conversationId, "assistant", result.done ?? `Could not: ${result.error}`, [
    { name: String(claimed.tool), ok: !result.error },
  ]);
  return toApproval(row);
}
