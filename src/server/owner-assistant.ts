import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { adminMapText, matchPath, pageParams, type SiteFlags } from "@/lib/admin-map";
import { skillsText } from "@/lib/assistant-skills";
import { MANAGER_TOOLS, MANAGER_TOOLS_BY_NAME, PLATFORM_TOOLS, PLATFORM_TOOLS_BY_NAME } from "@/lib/manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition, type GateCategory } from "@/lib/owner-tools";

import { AiError, aiFor, canSpeak, streamWithTools, type AiConnection, type ToolChatMessage, type ToolDefinition } from "./ai";
import { learnFromTurn, memoriesFor, type Memory } from "./assistant-memory";
import type { Account, Membership, Role } from "./auth";
import { askLife, lifeLink, lifeLinkOn, LifeLinkError } from "./kaizen-life-link";
import { runManagerTool, runPlatformTool, type ManagerContext } from "./manager-tools";
import { OwnerToolError, preflightOwnerTool, runOwnerTool } from "./owner-tools";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The AI manager (D94, D103): the admin's own assistant, modelled on Kaizen
 * Life's, for a store's owners and for Kaizen's platform admins. It runs a
 * tool loop with the site's AI (D73) over the store's or the platform's
 * reads and writes (`src/lib/owner-tools.ts`, `src/lib/manager-tools.ts`),
 * knows every admin page (`src/lib/admin-map.ts`) and opens them for the
 * person, follows playbooks (`src/lib/assistant-skills.ts`), remembers the
 * person (`assistant-memory.ts`), keeps the conversation, and stops at the
 * approval gate: a call that sends, publishes or spends is kept and runs
 * only when the person says yes. It works on its own; Kaizen Life is never
 * needed.
 */

/** Who the AI manager works for: an owner in their store, or a platform admin (store null). */
export type Principal = { account: Account; store: Store | null; role?: Role };

/** The conversations of the principal's area: the store's, or the platform's. */
const inScope = (p: Principal, column = sql`store_id`) => (p.store ? sql`${column} = ${p.store.id}::uuid` : sql`${column} is null`);
const storeIdOf = (p: Principal) => (p.store ? sql`${p.store.id}::uuid` : sql`null`);

/** Rounds of tools before the model must answer. */
const MAX_STEPS = 10;
/** Earlier turns the model is given, as text. */
const HISTORY = 20;
/** What the owner may send the assistant in a day, per store. */
export const DAILY_TURNS = 300;
/** A tool's answer is cut to this, keeping the model's context. */
const RESULT_MAX = 12_000;

export type ToolTrail = { name: string; ok: boolean };
export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolTrail[];
  /** The person's thumb on an answer: 1 up, -1 down. */
  feedback: 1 | -1 | null;
  createdAt: string;
};
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
  /** Opens an admin page in the person's browser (open_admin_page). */
  | { type: "navigate"; href: string; label: string }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; message: string };

/** What the AI manager can do here: text, the hands-free voice (hear and speak, D104) and a live voice call (D105). */
export type AssistantAbilities = { text: boolean; hear: boolean; speak: boolean; live: boolean };

export async function assistantAbilities(storeId: string | null): Promise<AssistantAbilities> {
  const connection = await aiFor(storeId);
  return {
    text: Boolean(connection?.textModel),
    hear: Boolean(connection?.transcriptionModel),
    speak: canSpeak(connection),
    live: Boolean(connection?.textModel && connection.live),
  };
}

// Conversations -------------------------------------------------------------------

const toMessage = (row: Row): AssistantMessage => ({
  id: String(row.id),
  role: row.role === "user" ? "user" : "assistant",
  content: String(row.content),
  tools: (row.tools as ToolTrail[] | null) ?? [],
  feedback: row.feedback === 1 || row.feedback === -1 ? row.feedback : null,
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

export async function listConversations(p: Principal): Promise<ConversationSummary[]> {
  const rows = await db().execute<Row>(sql`
    select id, title, updated_at from commerce.assistant_conversations
    where ${inScope(p)} and account_id = ${p.account.id}::uuid
    order by updated_at desc limit 50
  `);
  return rows.map((row) => ({ id: String(row.id), title: String(row.title), updatedAt: new Date(String(row.updated_at)).toISOString() }));
}

export async function getConversation(p: Principal, id: string): Promise<Conversation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [conversation] = await db().execute<Row>(sql`
    select id, title from commerce.assistant_conversations
    where id = ${id}::uuid and ${inScope(p)} and account_id = ${p.account.id}::uuid
  `);
  if (!conversation) return null;
  const [messages, approvals] = await Promise.all([
    db().execute<Row>(sql`select * from commerce.assistant_messages where conversation_id = ${id}::uuid order by created_at, id`),
    db().execute<Row>(sql`select * from commerce.assistant_approvals where conversation_id = ${id}::uuid order by created_at, id`),
  ]);
  return { id, title: String(conversation.title), messages: messages.map(toMessage), approvals: approvals.map(toApproval) };
}

export async function deleteConversation(p: Principal, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db().execute(sql`
    delete from commerce.assistant_conversations
    where id = ${id}::uuid and ${inScope(p)} and account_id = ${p.account.id}::uuid returning 1
  `);
  return rows.length > 0;
}

export async function addMessage(p: Principal, conversationId: string, role: "user" | "assistant", content: string, tools: ToolTrail[] = []) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_messages (store_id, conversation_id, role, content, tools)
    values (${storeIdOf(p)}, ${conversationId}::uuid, ${role}, ${content.slice(0, 20_000)}, ${JSON.stringify(tools)}::jsonb)
    returning *
  `);
  await db().execute(sql`update commerce.assistant_conversations set updated_at = now() where id = ${conversationId}::uuid`);
  return toMessage(row);
}

/**
 * The owner's conversation with Kaizen Life's assistant (D96): one per
 * store and owner, where its questions and the changes it asks for (kept
 * for approval) show in the admin like any other conversation.
 */
export async function kaizenLifeConversation({ store, account }: Membership): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_conversations (store_id, account_id, title, source)
    values (${store.id}::uuid, ${account.id}::uuid, 'From Kaizen Life', 'kaizen-life')
    on conflict (store_id, account_id) where source = 'kaizen-life' do update set updated_at = now()
    returning id
  `);
  return String(row.id);
}

// The prompt ------------------------------------------------------------------------

/**
 * Asking Kaizen Life's assistant (D96), offered only while the owner has
 * connected Kaizen Life and the question is not Kaizen Life's own, so the
 * two never ask each other in a loop. Not an owner tool: `/api/mcp` never
 * serves it.
 */
export const ASK_KAIZEN_LIFE: ToolDefinition = {
  name: "ask_kaizen_life",
  description:
    "Asks the owner's own assistant in Kaizen Life, their personal-life app, in words: their calendar, tasks and plans, or to note something there for them. Send only what the owner asked to pass on; it answers in words.",
  parameters: {
    type: "object",
    properties: { question: { type: "string", maxLength: 4000, description: "The question or request, complete in itself." } },
    required: ["question"],
    additionalProperties: false,
  },
};


/** What the admin offers this person here: pages behind a module, or for owners only. */
export function siteFlags(p: Principal): SiteFlags {
  return p.store ? { bookings: p.store.bookingsOn, deliveries: p.store.deliveriesOn, owner: p.role === "owner" } : {};
}

/**
 * Where the person is in the admin, for the AI: the page they are on, from
 * the address the browser sent, if it is a page of the area it works in.
 */
export function whereText(p: Principal, path: string | null | undefined): string | null {
  if (!path) return null;
  const match = matchPath(path);
  if (!match) return null;
  const { page, params, storeSlug } = match;
  if (page.area === "store" && (!p.store || storeSlug !== p.store.slug)) return null;
  if (page.area === "platform" && p.store) return null;
  const known = pageParams(page)
    .map((name) => `${name} ${params[name]}`)
    .join(", ");
  return [
    `They are on ${page.title} [${page.id}]${known ? ` (${known})` : ""}: ${page.what}`,
    ...(page.tasks?.length ? [`There they can: ${page.tasks.join("; ")}.`] : []),
  ].join("\n");
}

const memoryLine = (m: Memory) => `- [${m.id}] ${m.kind}${m.storeId ? "" : ", everywhere"}: ${m.content}`;

export type Waiting = { id: string; summary: string };

export function managerPrompt(
  p: Principal,
  options: { now?: Date; withLife?: boolean; where?: string | null; memories?: Memory[]; waiting?: Waiting[]; voice?: boolean } = {},
): string {
  const { store, account } = p;
  const now = options.now ?? new Date();
  const timeZone = store?.timeZone ?? "Europe/Oslo";
  const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone }).format(now);
  const who = account.name ? `, ${account.name}` : "";
  const area = store ? "store" : "platform";
  const intro = store
    ? [
        `You are the AI manager of ${store.name}, an online store on Kaizen, working for its owner${who} in the store's admin: their guide to the admin, their analyst and their right hand.`,
        `It is ${today} in the store's time zone (${timeZone}). The store sells in ${store.markets.map((m) => `${m.name} (${m.currency}, ${m.lang})`).join(", ") || "no countries yet"}${store.status === "active" ? "" : "; it is not open yet"}.`,
      ]
    : [
        `You are Kaizen's AI manager, working for a platform admin${who} in Kaizen's platform admin, where Kaizen's team runs the platform: access requests, stores and their plans and fees, and Kaizen's own site. You are their guide to the admin, their analyst and their right hand.`,
        `It is ${today} (${timeZone}).`,
      ];
  const memories = options.memories ?? [];
  return [
    ...intro,
    "",
    "How you work:",
    `- Everything you say about the ${store ? "store" : "platform"} comes from your tools, in this turn or earlier ones. Never guess or invent orders, products, stores, prices, stock, customers or totals.`,
    "- Amounts come written out by the tools: repeat them as given. Never add up, average or convert amounts yourself: the tools do the sums.",
    "- Look things up before acting on them, so you use real numbers, names and ids.",
    "- Changes that send something, change what a site shows or cost money are not made by you: your call is kept for them to approve, with a button under your answer. Say plainly what is waiting for their yes. Never say it is done before it is.",
    "- They may answer a waiting change in words instead (\"yes, send it\", \"no\"): then carry out that answer with decide_approval, by its id. Only for a change they answered in this message; if their answer is unclear, ask.",
    "- If a tool refuses or fails, say what it said. If no tool can do what is asked, say so and open or name the admin page that can.",
    "- Answer in the language they write in. Keep answers short and concrete, in plain text: short lines or simple lists, no tables and no HTML.",
    ...(options.withLife
      ? [
          "- They have connected Kaizen Life, their personal-life app: ask_kaizen_life asks its assistant about their calendar, tasks and plans. Use it only when they ask about those or ask you to pass something on. Pass its answer on as said, and never send it customers' details unless they ask you to.",
        ]
      : []),
    "",
    "Guiding them through the admin:",
    "- You know every page of the admin (the map below). When they ask how or where to do something, answer in a few steps naming the page, and offer to take them there.",
    "- open_admin_page opens a page in their browser: use it when they ask to go somewhere or say yes to your offer. Pages that need an id (one order, one product) are found with find_admin_page, with the id from your tools.",
    "- Describe only pages, sections and buttons the map and find_admin_page give; never invent them. When they seem lost or new, suggest the next useful step.",
    "",
    "Skills: for these jobs, load the playbook with use_skill first and follow it:",
    skillsText(area),
    "",
    "Memory:",
    "- What you know about them, from earlier conversations, is below. Use it without reciting it: answer the way they like, and keep their routines and goals in mind.",
    "- When they tell you something lasting (how they like to work, their business, routines, goals, rules), or ask you to remember something, keep it with remember. When something you know is wrong or they ask you to forget it, correct it with remember or remove it with forget, by its id. recall looks up more.",
    "- Never keep customers' personal details, passwords, keys or card numbers.",
    "",
    `The admin (section: page [id]):`,
    adminMapText(area, siteFlags(p)),
    ...(options.where ? ["", "Where they are now:", options.where] : []),
    ...(options.waiting?.length
      ? ["", "Changes waiting for their yes (id: what it does):", ...options.waiting.map((w) => `- [${w.id}] ${w.summary.replace(/\s+/g, " ").slice(0, 300)}`)]
      : []),
    ...(options.voice
      ? [
          "",
          "They are talking to you by voice, and your answer is read aloud:",
          "- Speak in plain sentences: no lists, tables, Markdown, links, addresses or ids (the screen shows those; say \"I've opened it\" or \"it's on the screen\").",
          "- Lead with the answer, then the next step. Usually two to four sentences, at most about 100 words; offer more if there is more.",
          "- Say amounts and numbers as the tools wrote them.",
          "- Before a longer lookup you may say a few words first, such as \"Let me check.\"",
          "- When a change waits for their yes, say in one sentence what it will do and ask them to say yes or no.",
        ]
      : []),
    "",
    "What you know about them:",
    memories.length ? memories.map(memoryLine).join("\n") : "Nothing yet.",
  ].join("\n");
}

// A turn ---------------------------------------------------------------------------------

export type TurnInput = {
  /** Who it works for: an owner in a store (a membership), or a platform admin (store null). */
  member: Principal;
  conversationId: string | null;
  message: string;
  emit: (event: AssistantEvent) => void;
  invalidate: (tag: string) => void;
  signal?: AbortSignal;
  /** The admin page the person is on, so it knows where they are. */
  path?: string | null;
  /** Runs work after the answer is sent (the route's `after()`): learning from the turn. Without it, nothing is learned. */
  later?: (task: () => Promise<unknown>) => void;
  /** Spoken in voice mode (D104): the answer is read aloud, so it is written to be heard. */
  voice?: boolean;
  /**
   * For a live voice call (D105): the request is the person's last message,
   * already saved, so it is not kept again; and the answer is not kept, since
   * the call's transcript keeps what the voice said.
   */
  live?: { reuseSaved: boolean };
  /** Kaizen Life's assistant is asking (D96): answer without asking it back. */
  fromKaizenLife?: boolean;
  /** The connection to use; the site's own (D73) unless given (tests). */
  connection?: AiConnection | null;
};

/** Whether today's turns have reached the limit: per store, or per platform admin. */
async function overLimit(p: Principal): Promise<boolean> {
  const [row] = p.store
    ? await db().execute<Row>(sql`
        select count(*)::int as n from commerce.assistant_messages
        where store_id = ${p.store.id}::uuid and role = 'user' and created_at > now() - interval '1 day'
      `)
    : await db().execute<Row>(sql`
        select count(*)::int as n from commerce.assistant_messages m
        join commerce.assistant_conversations c on c.id = m.conversation_id
        where m.store_id is null and c.account_id = ${p.account.id}::uuid and m.role = 'user' and m.created_at > now() - interval '1 day'
      `);
  return Number(row.n) >= DAILY_TURNS;
}

/**
 * The person's message, answered: kept, run through the tool loop with the
 * conversation so far, and the answer kept. Events stream as it goes; what
 * was lasting in it is learned afterwards.
 */
export async function runTurn(input: TurnInput): Promise<void> {
  const { member: p, emit } = input;
  const { store, account } = p;
  const text = input.message.trim().slice(0, 4000);
  if (!text) return emit({ type: "error", message: "Write something first." });
  const connection = input.connection === undefined ? await aiFor(store?.id ?? null, { feature: "ai_manager", accountId: account.id }) : input.connection;
  if (!connection?.textModel) {
    return emit({
      type: "error",
      message: `The AI manager needs a text model: set one up under ${store ? "Settings → AI" : "Platform → AI"}.`,
    });
  }
  if (await overLimit(p)) {
    return emit({ type: "error", message: `The AI manager has answered ${DAILY_TURNS} messages ${store ? "for this store" : "for you"} today. It is back tomorrow.` });
  }

  let conversationId = input.conversationId;
  if (conversationId && !(await getConversation(p, conversationId))) conversationId = null;
  if (!conversationId) {
    const title = text.replace(/\s+/g, " ").slice(0, 80);
    const [row] = await db().execute<Row>(sql`
      insert into commerce.assistant_conversations (store_id, account_id, title)
      values (${storeIdOf(p)}, ${account.id}::uuid, ${title}) returning id
    `);
    conversationId = String(row.id);
    emit({ type: "conversation", id: conversationId, title });
  }
  const startedAt = new Date();
  const [history, memories, withLife, waiting] = await Promise.all([
    db().execute<Row>(sql`
      select role, content from (
        select role, content, created_at, id from commerce.assistant_messages
        where conversation_id = ${conversationId}::uuid order by created_at desc, id desc limit ${HISTORY}
      ) recent order by created_at, id
    `),
    memoriesFor(account.id, store?.id ?? null, text, connection).catch((error) => {
      console.error("[ai-manager] memories", error);
      return [] as Memory[];
    }),
    !input.fromKaizenLife && lifeLinkOn() ? lifeLink(account.id).then((link) => link !== null) : Promise.resolve(false),
    db().execute<Row>(sql`
      select id, summary from commerce.assistant_approvals
      where conversation_id = ${conversationId}::uuid and account_id = ${account.id}::uuid and status = 'pending'
      order by created_at limit 10
    `),
  ]);
  if (!input.live?.reuseSaved) await addMessage(p, conversationId, "user", text);

  const ctx: ManagerContext = {
    account,
    store,
    flags: siteFlags(p),
    connection,
    navigate: (href, label) => emit({ type: "navigate", href, label }),
    invalidate: input.invalidate,
    turn: {
      conversationId,
      said: text,
      startedAt,
      decide: async (approvalId, approve) => {
        const decided = await decideApproval(p, approvalId, approve, input.invalidate, { note: false });
        if (decided) emit({ type: "approval", approval: decided });
        return decided;
      },
    },
  };
  const tools = [...(store ? OWNER_TOOLS : PLATFORM_TOOLS).map(toolDefinition), ...MANAGER_TOOLS.map(toolDefinition), ...(withLife ? [ASK_KAIZEN_LIFE] : [])];
  const messages: ToolChatMessage[] = [
    {
      role: "system",
      content: managerPrompt(p, {
        withLife,
        where: whereText(p, input.path),
        memories,
        voice: input.voice,
        waiting: waiting.map((row) => ({ id: String(row.id), summary: String(row.summary) })),
      }),
    },
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
        const result =
          withLife && call.function.name === ASK_KAIZEN_LIFE.name
            ? await askKaizenLife(p, call.function.arguments)
            : await callTool(ctx, conversationId, call.function.name, call.function.arguments, emit);
        trail.push({ name: call.function.name, ok: !("error" in result) });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, RESULT_MAX) });
      }
    }
  } catch (error) {
    const message = error instanceof AiError ? `The AI did not answer: ${error.message}` : "Something went wrong. Try again.";
    if (!(error instanceof AiError)) console.error("[ai-manager]", error);
    const saved = await addMessage(p, conversationId, "assistant", message, trail);
    emit({ type: "error", message });
    emit({ type: "done", message: saved });
    return;
  }
  const answered = reply.trim() || "(No answer.)";
  const saved = input.live
    ? { id: "live", role: "assistant" as const, content: answered, tools: trail, feedback: null, createdAt: new Date().toISOString() }
    : await addMessage(p, conversationId, "assistant", answered, trail);
  emit({ type: "done", message: saved });
  if (input.later && !input.fromKaizenLife && reply.trim()) {
    input.later(() =>
      learnFromTurn({ accountId: account.id, storeId: store?.id ?? null, connection, said: text, answered }).catch((error) =>
        console.error("[ai-manager] learning", error),
      ),
    );
  }
}

/** Kaizen Life's assistant's answer for the model, or why there is none. */
async function askKaizenLife(p: Principal, rawArgs: string): Promise<Record<string, unknown>> {
  let question = "";
  try {
    const args = JSON.parse(rawArgs || "{}") as { question?: unknown };
    question = typeof args.question === "string" ? args.question.trim() : "";
  } catch {
    return { error: "The arguments were not valid JSON." };
  }
  if (!question) return { error: "Ask a question in words." };
  try {
    return { kaizen_life_says: await askLife(p.account.id, question, p.store?.name ?? "Kaizen") };
  } catch (error) {
    if (error instanceof LifeLinkError) return { error: error.message };
    console.error("[ai-manager] ask_kaizen_life", error);
    return { error: "Kaizen Life did not answer." };
  }
}

/** One tool call: run, or kept for approval if it is gated; its answer (or error) for the model. */
async function callTool(
  ctx: ManagerContext,
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
  const manager = MANAGER_TOOLS_BY_NAME[name];
  const tool = (ctx.store ? OWNER_TOOLS_BY_NAME[name] : PLATFORM_TOOLS_BY_NAME[name]) ?? manager;
  if (!tool) return { error: `There is no tool called ${name}.` };
  if (tool.gate) {
    const input = readToolInput(tool, args);
    if (!input.ok) return { error: `The arguments could not be read: ${input.problem}` };
    // What could not be done, or must be reworded (claims), is refused now, never kept for a yes.
    if (ctx.store) {
      try {
        await preflightOwnerTool({ account: ctx.account, store: ctx.store, invalidate: ctx.invalidate }, name, args);
      } catch (error) {
        if (error instanceof OwnerToolError) return { error: error.message };
        console.error(`[ai-manager] ${name}`, error);
        return { error: "The tool failed." };
      }
    }
    const approval = await keepForApproval(ctx, conversationId, name, tool.gate, input.input as Record<string, unknown>);
    emit({ type: "approval", approval });
    return {
      queued_for_approval: true,
      what: approval.summary,
      note: "Not done yet: they approve or decline it with the button under your answer. Tell them it is waiting.",
    };
  }
  try {
    if (manager) return { result: await runManagerTool(ctx, name, args) };
    if (ctx.store) return { result: await runOwnerTool({ account: ctx.account, store: ctx.store, invalidate: ctx.invalidate }, name, args) };
    return { result: await runPlatformTool(ctx, name, args) };
  } catch (error) {
    if (error instanceof OwnerToolError) return { error: error.message };
    console.error(`[ai-manager] ${name}`, error);
    return { error: "The tool failed." };
  }
}

type ApprovalContext = { account: Account; store: Store | null; invalidate: (tag: string) => void };

/** A gated call kept for the person's yes, described in words made from its arguments and the site's data. */
export async function keepForApproval(
  ctx: ApprovalContext,
  conversationId: string,
  tool: string,
  category: GateCategory,
  args: Record<string, unknown>,
): Promise<Approval> {
  let summary = approvalSummary(tool, args);
  const store = ctx.store;
  if (store && tool === "cancel_booking") {
    const [booking] = await db().execute<Row>(sql`
      select b.starts_at, coalesce((select t.title from commerce.product_translations t where t.product_id = b.product_id order by t.locale limit 1), '') as service,
        coalesce(nullif(o.billing_address ->> 'name', ''), o.email, '') as customer
      from commerce.bookings b left join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
      where b.store_id = ${store.id}::uuid and b.id = ${String(args.booking)}::uuid
    `);
    if (booking) {
      const when = new Intl.DateTimeFormat(store.markets[0]?.locale ?? "en", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone }).format(
        new Date(String(booking.starts_at)),
      );
      summary = `Cancel ${booking.service} on ${when}${booking.customer ? ` for ${booking.customer}` : ""}${args.notify === false ? "" : ", and email the customer"}.`;
    }
  }
  if (store && tool === "unpublish_page") {
    const [page] = await db().execute<Row>(sql`
      select published ->> 'title' as title from commerce.pages where store_id = ${store.id}::uuid and id = ${String(args.page)}::uuid
    `);
    if (page?.title) summary = `Take "${page.title}" off the site, keeping its draft.`;
  }
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_approvals (store_id, conversation_id, account_id, tool, args, summary, category)
    values (${store ? sql`${store.id}::uuid` : sql`null`}, ${conversationId}::uuid, ${ctx.account.id}::uuid, ${tool}, ${JSON.stringify(args)}::jsonb, ${summary}, ${category})
    returning *
  `);
  return toApproval(row);
}

/**
 * The person's answer to a kept call: yes runs exactly the call that was
 * kept, once (the row is claimed first); no declines it. Either way the
 * conversation says what happened.
 */
export async function decideApproval(
  p: Principal,
  approvalId: string,
  approve: boolean,
  invalidate: (tag: string) => void,
  /** `note: false` when answered in words during a turn, whose answer says what happened. */
  { note = true }: { note?: boolean } = {},
): Promise<Approval | null> {
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return null;
  const [claimed] = await db().execute<Row>(sql`
    update commerce.assistant_approvals set status = ${approve ? "done" : "declined"}, decided_at = now()
    where id = ${approvalId}::uuid and ${inScope(p)} and account_id = ${p.account.id}::uuid and status = 'pending'
    returning *
  `);
  if (!claimed) return null;
  const conversationId = String(claimed.conversation_id);
  if (!approve) {
    if (note) await addMessage(p, conversationId, "assistant", `Declined: ${claimed.summary}`);
    return toApproval(claimed);
  }
  let result: { done?: string; error?: string };
  try {
    const tool = String(claimed.tool);
    const answer = (
      p.store
        ? await runOwnerTool({ account: p.account, store: p.store, invalidate }, tool, claimed.args)
        : await runPlatformTool({ account: p.account, store: null, flags: {}, connection: null, navigate: () => {}, invalidate }, tool, claimed.args)
    ) as { done?: string };
    result = { done: answer?.done ?? "Done." };
  } catch (error) {
    result = { error: error instanceof OwnerToolError ? error.message : "It could not be done." };
    if (!(error instanceof OwnerToolError)) console.error("[ai-manager] approval", error);
  }
  const [row] = await db().execute<Row>(sql`
    update commerce.assistant_approvals set status = ${result.error ? "failed" : "done"}, result = ${JSON.stringify(result)}::jsonb
    where id = ${approvalId}::uuid returning *
  `);
  if (note) await addMessage(p, conversationId, "assistant", result.done ?? `Could not: ${result.error}`, [{ name: String(claimed.tool), ok: !result.error }]);
  return toApproval(row);
}

/**
 * A thumb on an answer (D103): kept on the message, and, if the person lets
 * it learn, what it says about how they like to be answered is learned
 * afterwards. A null value takes the thumb back.
 */
export async function rateAnswer(
  p: Principal,
  messageId: string,
  value: 1 | -1 | null,
  note: string | null,
  later?: (task: () => Promise<unknown>) => void,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return false;
  const [row] = await db().execute<Row>(sql`
    update commerce.assistant_messages m set feedback = ${value}
    from commerce.assistant_conversations c
    where m.id = ${messageId}::uuid and m.role = 'assistant' and c.id = m.conversation_id
      and c.account_id = ${p.account.id}::uuid and ${inScope(p, sql`c.store_id`)}
    returning m.conversation_id, m.content
  `);
  if (!row) return false;
  if (value !== null && later) {
    const storeId = p.store?.id ?? null;
    later(async () => {
      const connection = await aiFor(storeId, { feature: "ai_manager", accountId: p.account.id });
      if (!connection?.textModel) return;
      const [asked] = await db().execute<Row>(sql`
        select content from commerce.assistant_messages
        where conversation_id = ${String(row.conversation_id)}::uuid and role = 'user'
          and created_at <= (select created_at from commerce.assistant_messages where id = ${messageId}::uuid)
        order by created_at desc, id desc limit 1
      `);
      await learnFromTurn({
        accountId: p.account.id,
        storeId,
        connection,
        said: String(asked?.content ?? ""),
        answered: String(row.content),
        feedback: { value, note: note?.slice(0, 500) || undefined },
      }).catch((error) => console.error("[ai-manager] learning from a thumb", error));
    });
  }
  return true;
}
