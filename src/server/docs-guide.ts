import "server-only";

import { z } from "zod";

import { DOC_AREAS, DOC_KINDS, DOC_TRACKS, type DocLang } from "@/lib/docs-content";
import { cleanGuideReply, guideSystemPrompt, guideTools, type GuideToolName } from "@/lib/docs-guide";
import { GUIDE_HISTORY, GUIDE_LINKS_MAX, withoutSecrets, type GuideAction, type GuideLang, type GuideLink, type GuideSupport, type GuideTurnAnswer } from "@/lib/docs-guide-shape";
import type { GuideTurnInput } from "@/lib/docs-guide-schema";
import { adminTarget, apiOperation, docsTarget, mcpTool, readDoc, webhookTopic, type AdminVisitor } from "@/lib/docs-guide-tools";
import { docsHost, docsSiteHref } from "@/lib/docs-host";
import { NO_FILTERS, type DocsSearchHit } from "@/lib/docs-search";
import { siteUrl } from "@/lib/site";

import { AiError, chatWithTools, type AiConnection, type ToolChatMessage } from "./ai";
import { docsIndex } from "./docs";
import type { DocsGuideSettings } from "./docs-guide-settings";
import { addGuideMessage, guideConversation, guideFeed, guideHistory, openGuideConversation } from "./docs-guide-store";
import { countGuideMiss, searchDocs } from "./docs-search";
import { log } from "./log";
import { getPlatformChrome } from "./platform-navigation";
import { guidePromptVersion } from "./prompt-versions";

/**
 * The docs guide (wave 14 unit E5, D444): a second chat agent beside the platform chat (D81), on the docs alone. The model words the answers
 * and chooses tools; every fact comes from the docs' search (E3, `searchDocs()`), a page of the docs or the generated reference
 * (`docs-guide-tools.ts`), or unit A's contracts, never from a store, and the pages it used are linked under its answer by code. Its text is
 * cleaned (`cleanGuideReply()`) and shown as text. A reader is known only by their tab's token; the conversation is kept as the platform
 * chat's are (`docs-guide-store.ts`), with every token, key and password taken out of what the reader wrote before it is kept or sent.
 */

/** Rounds of tools before the model must answer. */
const ROUNDS = 4;
/** Tools run in one round, at most. */
const AT_ONCE = 4;
/** Search results the model is given. */
const RESULTS = 6;

const json = (value: unknown) => JSON.stringify(value);

/** Who is asking: the docs' language and page, whether they are signed in (and their stores, for the admin's pages), and their budget key. */
export type GuideReader = { lang: GuideLang; page: string | null; admin: AdminVisitor | null; visitor: string };

/** What a run of the guide gives back: its words, the pages it used, a page it opened, the support it offered and the topic it noted. */
export type GuideRun = { reply: string; links: GuideLink[]; action?: GuideAction; support?: GuideSupport; topic?: string };

/** What the tools of one turn found, for the answer's links, the page it opened and the support it offered. */
type TurnState = { read: GuideLink[]; searched: GuideLink[]; action?: GuideAction; topic?: string };

/** A search hit's page as the guide names it (`owners/…/slug#anchor`): its address without the docs' own prefix. */
function hitPage(hit: DocsSearchHit): string {
  const base = docsHost() ? (hit.lang === "nb" ? "/no" : "") : hit.lang === "nb" ? "/no/docs" : "/docs";
  return hit.href.slice(base.length).replace(/^\//, "");
}

const searchArgs = z.object({
  query: z.string().trim().min(1).max(200),
  track: z.enum(DOC_TRACKS).optional().catch(undefined),
  kind: z.enum(DOC_KINDS).optional().catch(undefined),
  area: z.enum(DOC_AREAS).optional().catch(undefined),
  lang: z.enum(["en", "nb"]).optional().catch(undefined),
});

const str = (value: unknown, max = 300) => (typeof value === "string" ? value.slice(0, max) : "");

/** One of the guide's tools, as JSON for the model; what it found is noted in `state`. Nothing here reads or changes a store. */
async function runTool(name: string, args: Record<string, unknown>, reader: GuideReader, state: TurnState): Promise<string> {
  const index = docsIndex();
  const lang: DocLang = reader.lang;
  switch (name as GuideToolName) {
    case "search_docs": {
      const parsed = searchArgs.safeParse(args);
      if (!parsed.success) return json({ error: "Say what to search for." });
      const { query, ...filters } = parsed.data;
      const found = await searchDocs({
        q: query,
        filters: { ...NO_FILTERS, track: filters.track ? [filters.track] : [], kind: filters.kind ? [filters.kind] : [], area: filters.area ? [filters.area] : [], lang: filters.lang ? [filters.lang] : [] },
        sort: "relevance",
        cursor: null,
      });
      if (!found.ok) return json({ error: "That search could not be read." });
      const { answer } = found;
      const results = answer.results.slice(0, RESULTS).map((hit) => ({
        page: hitPage(hit),
        lang: hit.lang,
        title: hit.title,
        ...(hit.headings.length > 0 && { headings: hit.headings }),
        track: hit.track,
        kind: hit.item === "section" ? hit.kind : hit.item,
        ...(hit.code && { code: hit.code }),
        words: hit.snippet.map((part) => part.text).join("").slice(0, 400),
      }));
      // A search whose words all matched may stand for the pages used, when nothing is read.
      if (answer.match === "all") {
        for (const hit of answer.results.slice(0, 3)) state.searched.push({ title: hit.headings.length > 0 ? `${hit.title}: ${hit.headings.at(-1)}` : hit.title, href: hit.href });
      }
      return json({
        found: answer.found,
        match: answer.match,
        results,
        ...(answer.found === 0 && { note: "Nothing in the docs matches. Try other words once; if still nothing, the docs do not cover it: say so and call offer_support." }),
        ...(answer.match === "any" && { note: "No page has every word: these have some. Read one before you say it answers." }),
      });
    }
    case "read_doc": {
      const answer = readDoc(index, str(args.page), args.lang === "nb" || args.lang === "en" ? args.lang : lang);
      if (answer.link) state.read.push(answer.link);
      return json(answer.result);
    }
    case "api_operation": {
      const answer = apiOperation(index, str(args.operation, 200), args.api === "storefront" ? "storefront" : "admin");
      if (answer.link) state.read.push(answer.link);
      return json(answer.result);
    }
    case "webhook_topic": {
      const answer = webhookTopic(index, typeof args.topic === "string" ? args.topic.slice(0, 100) : undefined);
      if (answer.link) state.read.push(answer.link);
      return json(answer.result);
    }
    case "mcp_tool": {
      const answer = mcpTool(index, str(args.name, 100));
      if (answer.link) state.read.push(answer.link);
      return json(answer.result);
    }
    case "navigate": {
      if (args.to === "admin") {
        const target = adminTarget(str(args.path), reader.admin);
        if ("error" in target) return json({ error: target.error });
        state.action = target;
        return json({ opened: target.label });
      }
      const target = docsTarget(index, str(args.page), lang);
      if (!target) return json({ error: "The docs have no such page. Search first." });
      state.action = target;
      return json({ opened: target.label });
    }
    case "offer_support":
      state.topic = str(args.topic, 200) || "unknown";
      return json({ shown: "How to reach Kaizena Flow's support is shown under your answer. Say in one sentence that the docs do not cover it." });
  }
  return json({ error: `No tool called ${name}.` });
}

/** The hosts whose addresses the guide's words may keep: Kaizena Flow's site and the docs' own. */
function ownHosts(): string[] {
  const hosts = ["kaizenaflow.com"];
  try {
    hosts.push(new URL(siteUrl()).host.toLowerCase());
  } catch {
    // A site address that cannot be read keeps only Kaizena Flow's own domain.
  }
  const docs = docsHost();
  if (docs) hosts.push(docs);
  return [...new Set(hosts)];
}

/** Kaizena Flow's support as the reader is offered it: the admin's *Kaizena Flow support*, and the platform's email address when it has one. */
async function supportOffer(): Promise<GuideSupport> {
  const email = await getPlatformChrome()
    .then((chrome) => chrome.business.contactEmail || null)
    .catch(() => null);
  return { admin: docsSiteHref("/admin/account/kaizen-support"), email };
}

const unique = (links: readonly GuideLink[]) => [...new Map(links.map((link) => [link.href, link])).values()].slice(0, GUIDE_LINKS_MAX);

/**
 * The guide's answer to the conversation's last message: the model gets the rules, the conversation and the tools, runs tools for a few
 * rounds and words the answer. The pages it read (else, when it read none and offered no support, the best of a search whose words all
 * matched) are its links.
 */
export async function runGuide(guide: Pick<DocsGuideSettings, "name" | "occupation" | "instructions">, reader: GuideReader, history: { role: "user" | "assistant"; content: string }[], connection: AiConnection, fallback: string): Promise<GuideRun> {
  const messages: ToolChatMessage[] = [
    {
      role: "system",
      content: guideSystemPrompt({
        agentName: guide.name,
        occupation: guide.occupation,
        lang: reader.lang,
        instructions: guide.instructions,
        page: reader.page,
        signedIn: reader.admin !== null,
        today: new Date().toISOString().slice(0, 10),
      }),
    },
    ...history.map((message) => ({ role: message.role, content: message.content }) as ToolChatMessage),
  ];
  const tools = guideTools();
  const state: TurnState = { read: [], searched: [] };
  let raw = "";
  for (let round = 0; round <= ROUNDS; round++) {
    const step = await chatWithTools(connection, messages, round < ROUNDS ? tools : [], { maxTokens: 700 });
    if (step.toolCalls.length === 0 || round === ROUNDS) {
      raw = step.content ?? "";
      break;
    }
    messages.push({ role: "assistant", content: step.content, tool_calls: step.toolCalls });
    for (const call of step.toolCalls.slice(0, AT_ONCE)) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        // Unreadable arguments: the tool says what it needs.
      }
      let result: string;
      try {
        result = await runTool(call.function.name, args, reader, state);
      } catch (error) {
        if (error instanceof AiError) throw error;
        log("warn", "docs_guide.tool_failed", { tool: call.function.name }, error);
        result = json({ error: "That did not work just now." });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 7000) });
    }
    for (const call of step.toolCalls.slice(AT_ONCE)) messages.push({ role: "tool", tool_call_id: call.id, content: json({ error: "Too many tools at once." }) });
  }
  const links = unique(state.read.length > 0 ? state.read : state.topic ? [] : state.searched);
  return {
    reply: cleanGuideReply(raw, fallback, ownHosts()),
    links,
    ...(state.action && { action: state.action }),
    ...(state.topic && { support: await supportOffer(), topic: state.topic }),
  };
}

export type GuideTurnResult = { ok: true; answer: GuideTurnAnswer } | { ok: false; status: 404 | 409; problem: "gone" | "full" } | { ok: false; status: 502; problem: "ai"; answer: GuideTurnAnswer };

/**
 * A reader's message: the conversation is made on the first message and continued with the tab's token (a wrong, old or full one starts a
 * new one); the message is kept, without any secret in it, before the AI is asked, so a failing AI loses nothing; the answer is kept with
 * the pages it used and its prompt version (D391); a question the docs do not cover is counted for the gap list. The answer is every message
 * after the one the tab last saw.
 */
export async function guideTurn(input: GuideTurnInput, guide: DocsGuideSettings, connection: AiConnection, reader: GuideReader, words: { sorry: string }): Promise<GuideTurnResult> {
  let conversation = input.conversation ? await guideConversation(input.conversation) : null;
  let token: string | undefined;
  let after = input.after;
  if (!conversation) {
    const opened = await openGuideConversation({ lang: reader.lang, page: reader.page });
    conversation = opened.conversation;
    token = opened.token;
    after = 0;
  }
  const { text, removed } = withoutSecrets(input.message);
  const added = await addGuideMessage(conversation.id, "reader", text);
  if (!added) return { ok: false, status: 409, problem: "full" };
  const ref = { id: conversation.id, ...(token && { token }) };
  let run: GuideRun;
  try {
    run = await runGuide(guide, reader, await guideHistory(conversation.id, GUIDE_HISTORY), connection, words.sorry);
  } catch (error) {
    log("warn", "docs_guide.ai_failed", {}, error);
    return { ok: false, status: 502, problem: "ai", answer: { conversation: ref, messages: await guideFeed(conversation.id, after), ...(removed && { removedSecret: true }) } };
  }
  if (run.topic) {
    await countGuideMiss(run.topic, reader.lang, reader.visitor).catch((error: unknown) => log("warn", "docs_guide.miss_failed", {}, error));
  }
  await addGuideMessage(conversation.id, "ai", run.reply, {
    ...(run.links.length > 0 && { links: run.links }),
    ...(run.action && { action: run.action }),
    ...(run.support && { support: run.support }),
    prompt: guidePromptVersion(),
  });
  return { ok: true, answer: { conversation: ref, messages: await guideFeed(conversation.id, after), ...(removed && { removedSecret: true }) } };
}
