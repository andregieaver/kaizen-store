import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * Every public path to a model, with its ceiling (bloat review step 0.21). A public entry is a page, route, layout or server action under
 * `src/app` outside the admin and the cron routes (and `src/proxy.ts`): a visitor can make it run. Walking its imports (static, and
 * `import()` with a written path) from every entry reaches almost everything, because page content and a few hubs (`page-article` ->
 * `search-section`, `site-cookies` -> `chat-agent`, `staff-alerts` -> `briefing`, `store-mcp` -> `owner-assistant`) connect it, so the
 * table is kept per MODULE that calls a model, not per entry: each module that sends a request to a provider (a call of one of
 * `MODEL_CALLS`, the functions of `src/server/ai.ts` that do) and that a public entry reaches has a row saying what bounds a visitor's use
 * of it (`ceiling`: a budget by name and its numbers, a monthly cap, signed-in owners only, a cron only) and the function that enforces it
 * (`enforcedBy`). A module reached only through a hub by import, and in fact only ever run for signed-in people or by a cron, says so.
 *
 * The test fails, naming the module and an entry that reaches it, when a model-calling module a public entry reaches has no row; when a
 * row names a module no public entry reaches any more (so the table only shrinks honestly); and when `enforcedBy` is not found by text:
 * `name()` in the module or a file it imports, or `name (file)` in that file (path under `src`). A row whose module a visitor reaches with
 * no ceiling at all is written `ceiling: "NONE (finding)"`, never with an invented one.
 */

const SRC = join(process.cwd(), "src");

/** The functions of `src/server/ai.ts` that send a request to a provider, and the live voice's session call. */
const MODEL_CALLS = ["completeText", "chatWithTools", "streamWithTools", "embedTexts", "generateImage", "editImage", "transcribeAudio", "speakText", "testAi"];
const MODEL_CALL = new RegExp(`\\b(?:${MODEL_CALLS.join("|")})\\(|apiUrl\\}/live/sessions`);

type Row = { ceiling: string; enforcedBy: string };

const SEARCH_ROOM =
  "searchAiRoom() on a search-cache miss only: search_ai (20 a minute a visitor, 600 a store), search_ai_hour (300 an hour a visitor, 3,000 a store) and the store's search tokens under SEARCH_AI_MONTHLY_TOKEN_CAP (1,000,000 a month); past any of them the search runs by keyword, never refused";
const CHAT_TURN = "takeChatTurn(): 30 messages a visitor per ten minutes and the site's daily limit (the agent's dailyLimit)";
const OWNER_TURN =
  "an owner's AI manager turn only: the admin (signed in), the owner MCP (/api/mcp: an owner's OAuth bearer token, takeMcpBudget() 120 calls a minute a grant and 1,200 a store) and the autopilot, follow-ups and Dream Factory steps in the dispatcher, each under the store's plan AI allowance (aiFor())";
const STAFF_DESK =
  "signed-in staff only: run on a staff action in the support desk (support-agent.ts) with a StaffDesk made from a membership (memberDesk()) or by the AI manager's tools (managerStaffDesk())";

const PUBLIC_MODEL_PATHS: Record<string, Row> = {
  "app/api/chat/voice/route.ts": {
    ceiling: `Each recording is counted before it is written down by takeTurn(), ${CHAT_TURN}; past the site's limit it is refused; 2 MB of audio at most, the answer read out once.`,
    enforcedBy: "takeTurn()",
  },
  "server/assistant-memory.ts": {
    ceiling: `${OWNER_TURN}; it learns only while the owner has learning on (learningOn()). Reached from public entries through store-mcp -> owner-assistant by import.`,
    enforcedBy: "takeMcpBudget() (app/api/mcp/route.ts)",
  },
  "server/ai-pictures.ts": {
    ceiling:
      "Signed-in owners and the Dream Factory's steps in the dispatcher: makePicture() only from page-ai's fillPicture(), testPicture() from the AI settings' Test (admin). Reached through admin-api -> api-uploads (shrinkPicture()) by import, never run for a visitor.",
    enforcedBy: "requirePermission (app/admin/(gated)/[store]/pages/ai/actions.ts)",
  },
  "server/briefing.ts": {
    ceiling:
      "A cron only: briefingNote() is called only by sendDueSummaries(), the dispatcher's summaries job. Reached from quotes, returns, orders and the supplier pages through staff-alerts by import, which sends alerts, never a note.",
    enforcedBy: "sendDueSummaries() (server/staff-alerts.ts)",
  },
  "server/chat-agent.ts": {
    ceiling: `A turn of the shopper chat (runChat(), also on an owner's own website) only after ${CHAT_TURN}; past the daily limit the conversation goes to a person, without the model. By email, takeChatTurn() per sender (support-inbound.ts). An owner's request to Kaizena Flow's support runs signed in from the admin.`,
    enforcedBy: "takeChatTurn() (server/chat-route.ts)",
  },
  "server/content-moderation.ts": {
    ceiling:
      "A notice's AI reading after the report budget (budgetRoom(): 5 an hour a visitor, refused past it and FAIL_CLOSED; 30 an hour the whole site, past which the notice is kept quietly, read later by the dispatcher); triageWaitingReports() and screenListings() run from the dispatcher.",
    enforcedBy: 'budgetRoom(null, "report" (app/(platform)/report/actions.ts)',
  },
  "server/docs-guide.ts": {
    ceiling:
      "Before the platform's model is asked: the docs_guide budget (10 a minute a reader, 600 the whole site, FAIL_CLOSED) and takeChatTurn() under guide: (30 a reader per ten minutes, the guide's daily limit).",
    enforcedBy: "takeChatTurn() (app/api/docs/guide/route.ts)",
  },
  "server/docs-search.ts": {
    ceiling:
      "A search's vector after the docs_search budget (120 a minute a reader, 6,000 the whole site, FAIL_CLOSED) on the docs' search page and /api/docs/search, or inside a guide turn (docs_guide); the index is embedded by the dispatcher (refreshDocsIndex()). /api/docs/read reaches it by import only.",
    enforcedBy: 'takeBudget(null, "docs_search" (app/api/docs/search/route.ts)',
  },
  "server/embeddings.ts": {
    ceiling:
      "Products without a vector only, a run's worth at a time: refreshStoreEmbeddings() after an owner's save, import or bulk edit (signed in, or the Admin API's import under an owner's token and the api budget, 120 calls a minute a token), refreshEmbeddings() from the dispatcher; under the store's plan AI allowance.",
    enforcedBy: "refreshStoreEmbeddings()",
  },
  "server/knowledge.ts": {
    ceiling: `searchKnowledge() embeds a query only inside a chat turn (the chat's search tool), under ${CHAT_TURN}; embedKnowledge() runs from the dispatcher (refreshKnowledge()) and after an owner saves the chat (refreshSiteKnowledge(), signed in), a run's worth of passages at a time.`,
    enforcedBy: "takeChatTurn() (server/chat-route.ts)",
  },
  "server/legal-writer.ts": {
    ceiling:
      "A cron and signed-in owners: the pages are written by runLegalWrites() (the dispatcher, and an owner's press in Settings, Legal) from writes owners queued. Reached from sign-up through self-signup -> dream-factory by import; a sign-up only queues a Dream Factory run.",
    enforcedBy: "runLegalWrites()",
  },
  "server/media-library.ts": {
    ceiling:
      "Signed-in staff and a cron: listMedia() embeds a library search on the admin's media pages (requirePermission website:read), embedMedia() runs from the dispatcher (refreshMediaEmbeddings()). Reached from sign-up and the theme pages through design-presets by import, never run for a visitor.",
    enforcedBy: "refreshMediaEmbeddings()",
  },
  "server/owner-assistant.ts": {
    ceiling: `${OWNER_TURN}. Reached by import through store-mcp, dream-factory and other hubs, never run for a visitor.`,
    enforcedBy: "takeMcpBudget() (app/api/mcp/route.ts)",
  },
  "server/page-ai.ts": {
    ceiling:
      "Signed-in owners (the page studio's actions, requirePermission website:write), the AI manager's tools (an owner's turn) and the Dream Factory's steps in the dispatcher (advanceDreamRuns()). Reached from sign-up through dream-factory -> site-tools by import; a sign-up (takeSignupSlot(): 3 an address a day, 20 a network an hour, then a confirmed email) only queues a run, under the new store's plan AI allowance.",
    enforcedBy: "requirePermission (app/admin/(gated)/[store]/pages/ai/actions.ts)",
  },
  "server/page-looks.ts": {
    ceiling:
      "An owner's turn (the AI manager's look tools, lookNow()) and the page-looks cron (runPageLooks()) on looks owners' tools asked for (requestLook()). Reached through store-mcp -> owner-tools by import, never run for a visitor.",
    enforcedBy: "runPageLooks()",
  },
  "server/product-writer.ts": {
    ceiling:
      "Signed-in owners: suggestProductText() from the product editor's action (requirePermission products:write) and the AI manager's writeProductTextsTool(). The Admin API reaches it through product-tools by import and uses only createProductTool() and updateProductTool().",
    enforcedBy: "requirePermission (app/admin/(gated)/[store]/products/actions.ts)",
  },
  "server/query-understanding.ts": { ceiling: `A search's filters: ${SEARCH_ROOM}.`, enforcedBy: "searchAiRoom()" },
  "server/query-vector.ts": {
    ceiling: `A search's vector: ${SEARCH_ROOM}. A recommendation's vector is asked only under recommend.ts's underCap().`,
    enforcedBy: "searchAiRoom()",
  },
  "server/recommend.ts": {
    ceiling:
      "Only recommendFor() asks the model (the cart, chat and stand-ins pass ai: false), from /api/recommendations: takeRecommendRequest() 240 asks a visitor per ten minutes, and the store's monthly token cap for recommendations (underCap(): recommendation_settings.monthly_token_cap, 1,000,000 by default; an owner may set none, which leaves the plan's AI allowance in aiFor()).",
    enforcedBy: "underCap()",
  },
  "server/status.ts": {
    ceiling:
      "A cron only: testAi() is the AI probe of runStatusChecks() in the five-minute dispatcher, once a day; the status page, its feed and its sign-up read the stored results.",
    enforcedBy: "runStatusChecks()",
  },
  "server/support-partner.ts": {
    ceiling: `${STAFF_DESK}: runPartner(). Reached through store-mcp -> owner-assistant -> support-manager-tools by import.`,
    enforcedBy: "memberDesk (app/admin/(gated)/[store]/support/actions.ts)",
  },
  "server/support-summary.ts": {
    ceiling: `One summary for each ended conversation (summarise() takes only one marked pending, a few tries), when the visitor or a person ends it or from the dispatcher; a visitor opens a conversation only with a message counted by takeTurn(), ${CHAT_TURN}. makeBrief() is the staff's.`,
    enforcedBy: "takeTurn() (app/api/chat/route.ts)",
  },
  "server/support-tone.ts": {
    ceiling: `One score for each customer message while the desk has tone on: a chat message is counted by takeTurn(), ${CHAT_TURN}; an email by INBOUND_PER_SENDER_HOUR (10) and INBOUND_PER_DESK_DAY (500).`,
    enforcedBy: "takeTurn() (app/api/chat/route.ts)",
  },
  "server/support-translate.ts": {
    ceiling: `${STAFF_DESK}. Reached through store-mcp -> owner-assistant -> support-manager-tools -> support-agent by import.`,
    enforcedBy: "memberDesk (app/admin/(gated)/[store]/support/actions.ts)",
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// The walk (the import walker of src/lib/storefront-bundle.scan.test.ts, server files too, and `import()` with a written path)
// ---------------------------------------------------------------------------------------------------------------------------------

const IMPORT = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Whether an import brings in only types, which are erased: `import type { A }`, `import { type A }`. */
function typesOnly(clause: string): boolean {
  if (/^type\s/.test(clause.trim())) return true;
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
  return named !== null && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));
}

function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? join(dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (file: string) => relative(SRC, file).replaceAll("\\", "/");
const directive = (text: string, name: string) => new RegExp(`^\\s*["']${name}["']`, "m").test(text.slice(0, 300));

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

const texts = new Map<string, string>();
const text = (file: string): string => {
  let found = texts.get(file);
  if (found === undefined) texts.set(file, (found = readFileSync(file, "utf8")));
  return found;
};

const edges = new Map<string, string[]>();
/** The files `file` imports (types left out), in the order written. */
function importsOf(file: string): string[] {
  let found = edges.get(file);
  if (found) return found;
  found = [];
  for (const match of text(file).matchAll(IMPORT)) {
    if (match[2] !== undefined && typesOnly(match[1])) continue;
    const target = resolve(file, match[2] ?? match[3] ?? match[4]);
    if (target && !found.includes(target)) found.push(target);
  }
  edges.set(file, found);
  return found;
}

const calls = new Map<string, boolean>();
/** Whether a file calls a model (comments left out); `src/server/ai.ts` defines the calls. */
function callsModel(file: string): boolean {
  let found = calls.get(file);
  if (found === undefined) calls.set(file, (found = file !== join(SRC, "server/ai.ts") && MODEL_CALL.test(text(file).replace(/^\s*(\/\/|\*).*$/gm, ""))));
  return found;
}

/** What `entry` reaches, each with the file that brought it in (breadth first, so the chain is a shortest one). */
function reach(entry: string): Map<string, string> {
  const seen = new Map<string, string>([[entry, ""]]);
  const queue = [entry];
  for (let i = 0; i < queue.length; i++) {
    for (const target of importsOf(queue[i])) {
      if (seen.has(target)) continue;
      seen.set(target, queue[i]);
      queue.push(target);
    }
  }
  return seen;
}

const ENTRY_NAME = /^(route|page|layout|default|loading|template|error|global-error|not-found|global-not-found)\.tsx?$/;

/** The public entries: pages, routes, layouts and server actions under `src/app` outside the admin and the cron routes, and the proxy. */
const ENTRIES = [
  ...files(join(SRC, "app")).filter((file) => {
    const name = rel(file);
    if (name.startsWith("app/admin/") || name.startsWith("app/api/cron/")) return false;
    return ENTRY_NAME.test(name.split("/").pop()!) || directive(text(file), "use server");
  }),
  join(SRC, "proxy.ts"),
];

type Found = Map<string, { entry: string; chain: string }>;

/** Each model-calling module the entries reach, with the first entry (in path order) that reaches it and the chain. */
function modelModules(entries: readonly string[], known: Found = new Map()): Found {
  const found: Found = new Map(known);
  for (const entry of entries) {
    const seen = reach(entry);
    for (const file of seen.keys()) {
      if (found.has(rel(file)) || !callsModel(file)) continue;
      const chain = [rel(file)];
      for (let at = seen.get(file); at; at = seen.get(at)) chain.unshift(rel(at));
      found.set(rel(file), { entry: rel(entry), chain: chain.join(" -> ") });
    }
  }
  return found;
}

/** Whether a row's `enforcedBy` is found by text: `name (file)` in that file, `name()` in the module or a file it imports. */
function enforced(module: string, enforcedBy: string): boolean {
  const named = /^(.*?) \((\S+\.tsx?)\)$/.exec(enforcedBy);
  const name = (named ? named[1] : enforcedBy).replace(/\(\)$/, "");
  if (name.trim() === "") return false;
  const file = join(SRC, module);
  if (named) {
    const where = join(SRC, named[2]);
    return existsSync(where) && text(where).includes(name);
  }
  return existsSync(file) && [file, ...importsOf(file)].some((f) => text(f).includes(name));
}

/** What the public entries reach, walked once for the file. */
let walked: Found | null = null;
const publicModules = (): Found => (walked ??= modelModules(ENTRIES));

/** What is wrong with `table` for the public entries and any `extra` ones, each problem naming the module (and the entry that reaches it). */
function problems(table: Record<string, Row>, extra: readonly string[] = []): string[] {
  const found = modelModules(extra, publicModules());
  const out: string[] = [];
  for (const [module, { entry, chain }] of found) {
    if (!table[module]) out.push(`${module} calls a model and is reached from ${entry} (${chain}): add its row to PUBLIC_MODEL_PATHS`);
  }
  for (const [module, row] of Object.entries(table)) {
    if (!found.has(module)) {
      out.push(`${module} is in PUBLIC_MODEL_PATHS but no public entry reaches a model call in it any more: remove its row`);
      continue;
    }
    if (row.ceiling.trim().length < 20) out.push(`${module}: say in its ceiling what bounds a visitor's use`);
    if (!enforced(module, row.enforcedBy)) out.push(`${module}: ${row.enforcedBy} is not found where its row says (reached from ${found.get(module)!.entry})`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A scratch entry in a temp folder: `page.tsx` importing `helper.ts`, whose body is `body`. */
function scratchEntry(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "public-model-paths-"));
  scratch.push(dir);
  writeFileSync(join(dir, "helper.ts"), body);
  writeFileSync(join(dir, "page.tsx"), `import { help } from "./helper";\nexport default async function Page() { return help(); }\n`);
  return join(dir, "page.tsx");
}

describe("public paths to a model", () => {
  it("finds the public entries to walk", () => {
    const names = ENTRIES.map(rel);
    for (const name of ["app/api/chat/route.ts", "app/s/[store]/[market]/search/page.tsx", "app/(platform)/report/actions.ts", "proxy.ts"]) expect(names).toContain(name);
    expect(names.some((name) => name.startsWith("app/admin/") || name.startsWith("app/api/cron/"))).toBe(false);
  });

  it("every model-calling module a public entry reaches has its ceiling, and every row is still reached", () => {
    const found = publicModules();
    // The table, as the walk finds it today (bloat review step 0.21): printed so a reader sees each module and one way in.
    console.log([...found].map(([module, { chain }]) => `${module}\n    ${PUBLIC_MODEL_PATHS[module]?.ceiling ?? "NO ROW"}\n    e.g. ${chain}`).join("\n"));
    expect(problems(PUBLIC_MODEL_PATHS)).toEqual([]);
    expect(Object.values(PUBLIC_MODEL_PATHS).filter((row) => row.ceiling.startsWith("NONE"))).toEqual([]);
  });

  it("would notice: a new entry reaching a model call with no row", () => {
    const entry = scratchEntry(`import { aiFor, completeText } from "@/server/ai";\nexport async function help() {\n  const ai = await aiFor(null);\n  return ai ? (await completeText(ai, [{ role: "user", content: "hi" }])).text : null;\n}\n`);
    const found = problems(PUBLIC_MODEL_PATHS, [entry]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`${rel(join(dirname(entry), "helper.ts"))} calls a model and is reached from ${rel(entry)}`);
  });

  it("would notice: a scratch entry that only names a model call in a comment is not a model path", () => {
    const entry = scratchEntry(`// completeText() is not called here\nexport async function help() {\n  return null;\n}\n`);
    expect(problems(PUBLIC_MODEL_PATHS, [entry])).toEqual([]);
  });

  it("would notice: a row no entry reaches any more, and a guard that is not where the row says", () => {
    const stale = { ...PUBLIC_MODEL_PATHS, "server/no-such-module.ts": { ceiling: "A cron only: never reached from a public entry.", enforcedBy: "nothing()" } };
    expect(problems(stale)).toEqual([expect.stringContaining("server/no-such-module.ts is in PUBLIC_MODEL_PATHS but no public entry reaches")]);
    const wrong = { ...PUBLIC_MODEL_PATHS, "server/query-vector.ts": { ...PUBLIC_MODEL_PATHS["server/query-vector.ts"], enforcedBy: "noSuchGuard()" } };
    expect(problems(wrong)).toEqual([expect.stringContaining("server/query-vector.ts: noSuchGuard() is not found")]);
  });
});
