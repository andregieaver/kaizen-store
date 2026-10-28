import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  APP_CALL_MS,
  APP_TOOLS_OFFERED,
  APPS_MAX,
  appKey,
  appToolName,
  isAppGate,
  readRpcAnswer,
  readToolList,
  toolAnswerText,
  type AppGate,
  type AppTool,
} from "@/lib/custom-apps";
import { UNTRUSTED_TEXT } from "@/lib/prompt-safety";
import { checkEndpointUrl } from "@/lib/webhook-signature";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/secret-box";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { safeFetch } from "./replicate-fetch";
import { encryptionKey } from "./settings";
import { col, typedRows } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * A custom app's tools for the AI manager (wave 9 unit J, D363, `docs/wave-9-platform.md` section 3, J): the only writer of
 * `commerce.custom_apps`. An owner registers an app's MCP endpoint (https, through the address guard `safeFetch()`) with its bearer token
 * (encrypted with the settings key, shown back only as a hint), its `tools/list` is read, and the owner switches tools on, each `read`
 * (run at once) or behind one of the AI manager's gates (`public`, `send`, `spend`: kept for the person's yes). The AI manager offers the
 * tools switched on to the store's owners as `app__{app}__{tool}` (`appToolsFor()`), and each call goes to the app within ten seconds
 * (`callAppTool()`), counted on the app (`calls`, `failed`); the app's answer is passed to the model as data from outside, its text only.
 */

export type CustomApp = {
  id: string;
  name: string;
  key: string;
  endpointHint: string;
  tokenHint: string | null;
  tools: AppTool[];
  switched: Record<string, AppGate>;
  calls: number;
  failed: number;
  listedAt: string | null;
  problem: string | null;
};

const appRow = z.object({
  id: col.uuid,
  name: col.text,
  key: col.text,
  endpoint_hint: col.text,
  token_hint: col.text.nullable(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()) })),
  switched: z.record(z.string(), z.string()),
  calls: col.int,
  failed: col.int,
  listed_at: col.timestampOrNull,
  problem: col.text.nullable(),
});

const toApp = (row: z.infer<typeof appRow>): CustomApp => ({
  id: row.id,
  name: row.name,
  key: row.key,
  endpointHint: row.endpoint_hint,
  tokenHint: row.token_hint,
  tools: row.tools,
  switched: Object.fromEntries(Object.entries(row.switched).filter(([, gate]) => isAppGate(gate))) as Record<string, AppGate>,
  calls: row.calls,
  failed: row.failed,
  listedAt: row.listed_at,
  problem: row.problem,
});

/** The store's apps, oldest first. */
export async function listCustomApps(storeId: string): Promise<CustomApp[]> {
  const rows = await typedRows(
    appRow,
    sql`select id, name, key, endpoint_hint, token_hint, tools, switched, calls, failed, listed_at, problem from commerce.custom_apps where store_id = ${storeId}::uuid order by created_at, id`,
  );
  return rows.map(toApp);
}

/** One JSON-RPC call to an MCP endpoint over HTTP: `initialize` first (its session kept for the call), then the method. */
async function rpc(endpoint: string, token: string | null, method: string, params: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; problem: string }> {
  const post = async (body: Record<string, unknown>, session: string | null) =>
    safeFetch(endpoint, {
      maxBytes: 1_000_000,
      timeoutMs: APP_CALL_MS,
      maxRedirects: 0,
      accept: "application/json, text/event-stream",
      post: {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(session ? { "Mcp-Session-Id": session } : {}),
        },
      },
    });
  const started = Date.now();
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Kaizena Flow", version: "1" } } }, null);
  if (!init.ok) return { ok: false, problem: init.problem };
  const sessionHeader = init.headers?.["mcp-session-id"];
  const session = typeof sessionHeader === "string" && /^[\x21-\x7e]{1,200}$/.test(sessionHeader) ? sessionHeader : null;
  if (session) await post({ jsonrpc: "2.0", method: "notifications/initialized" }, session).catch(() => null);
  if (Date.now() - started > APP_CALL_MS) return { ok: false, problem: "The app took too long to answer." };
  const answer = await post({ jsonrpc: "2.0", id: 2, method, params }, session);
  if (!answer.ok) return { ok: false, problem: answer.problem };
  const read = readRpcAnswer(new TextDecoder().decode(answer.bytes), answer.contentType);
  if (!read) return { ok: false, problem: "The app's answer could not be read." };
  if (read.error) return { ok: false, problem: `The app said: ${read.error.message}` };
  return { ok: true, result: read.result };
}

export type AppProblem = "name" | "endpoint" | "limit" | "key" | "list";

/** Registers an app (owners only, checked by the caller) and reads its tools; none is switched on yet. */
export async function addCustomApp(owner: Membership, input: { name: string; endpoint: string; token: string }): Promise<{ ok: true; id: string; tools: number } | { ok: false; problem: AppProblem; detail?: string }> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, problem: "name" };
  // The same rules as an endpoint for events (D354): https, a host name, the standard port, no login.
  const checked = checkEndpointUrl(input.endpoint);
  if (!checked.ok) return { ok: false, problem: "endpoint" };
  const endpoint = checked.url;
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "key" };
  const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.custom_apps where store_id = ${owner.store.id}::uuid`);
  if (Number(count?.n ?? 0) >= APPS_MAX) return { ok: false, problem: "limit" };
  const token = input.token.trim().slice(0, 2000) || null;
  const listed = await rpc(endpoint, token, "tools/list", {});
  if (!listed.ok) return { ok: false, problem: "list", detail: listed.problem };
  const tools = readToolList(listed.result);
  // Two apps never share a key: the second takes a number.
  const taken = new Set((await listCustomApps(owner.store.id)).map((a) => a.key));
  let short = appKey(name);
  for (let n = 2; taken.has(short); n++) short = `${appKey(name).slice(0, 13)}-${n}`;
  const host = checked.hint;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.custom_apps (store_id, name, key, endpoint_encrypted, endpoint_hint, token_encrypted, token_hint, tools, listed_at, created_by)
    values (${owner.store.id}::uuid, ${name}, ${short}, ${encryptSecret(endpoint, key)}, ${host}, ${token ? encryptSecret(token, key) : null},
      ${token ? secretHint(token) : null}, ${JSON.stringify(tools)}::jsonb, now(), ${owner.account.id}::uuid)
    returning id
  `);
  const id = String(row.id);
  await audit(owner.account.id, owner.store.id, "integration.custom_app_added", { name, host, tools: tools.length }, { area: "settings", target: { type: "custom_app", id } });
  return { ok: true, id, tools: tools.length };
}

/** The endpoint and token of an app of the store's, decrypted for a call. */
async function secretsOf(storeId: string, id: string): Promise<{ endpoint: string; token: string | null } | null> {
  const key = encryptionKey();
  if (!key) return null;
  const [row] = await db().execute<Row>(sql`select endpoint_encrypted, token_encrypted from commerce.custom_apps where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  if (!row) return null;
  return { endpoint: decryptSecret(String(row.endpoint_encrypted), key), token: row.token_encrypted ? decryptSecret(String(row.token_encrypted), key) : null };
}

/** Reads an app's tools again; a tool no longer listed is switched off. */
export async function relistCustomApp(owner: Membership, id: string): Promise<{ ok: true; tools: number } | { ok: false; problem: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, problem: "unknown" };
  const secrets = await secretsOf(owner.store.id, id);
  if (!secrets) return { ok: false, problem: "unknown" };
  const listed = await rpc(secrets.endpoint, secrets.token, "tools/list", {});
  if (!listed.ok) {
    await db().execute(sql`update commerce.custom_apps set problem = ${listed.problem.slice(0, 300)} where id = ${id}::uuid`);
    return { ok: false, problem: listed.problem };
  }
  const tools = readToolList(listed.result);
  const names = new Set(tools.map((t) => t.name));
  const [row] = await db().execute<Row>(sql`select switched from commerce.custom_apps where id = ${id}::uuid`);
  const switched = Object.fromEntries(Object.entries((row?.switched ?? {}) as Record<string, string>).filter(([name]) => names.has(name)));
  await db().execute(sql`
    update commerce.custom_apps set tools = ${JSON.stringify(tools)}::jsonb, switched = ${JSON.stringify(switched)}::jsonb, listed_at = now(), problem = null
    where id = ${id}::uuid
  `);
  return { ok: true, tools: tools.length };
}

/** Switches one of an app's listed tools on with a gate, or off (`null`), audited. */
export async function switchAppTool(owner: Membership, id: string, tool: string, gate: AppGate | null): Promise<boolean> {
  const app = (await listCustomApps(owner.store.id)).find((a) => a.id === id);
  if (!app || !app.tools.some((t) => t.name === tool)) return false;
  const switched = { ...app.switched };
  if (gate) switched[tool] = gate;
  else delete switched[tool];
  await db().execute(sql`update commerce.custom_apps set switched = ${JSON.stringify(switched)}::jsonb where id = ${id}::uuid`);
  await audit(owner.account.id, owner.store.id, "integration.custom_app_tool", { app: app.name, tool, gate: gate ?? "off" }, { area: "settings", target: { type: "custom_app", id } });
  return true;
}

/** Removes an app and its tools from the AI manager. */
export async function removeCustomApp(owner: Membership, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const gone = await db().execute<Row>(sql`delete from commerce.custom_apps where store_id = ${owner.store.id}::uuid and id = ${id}::uuid returning name`);
  if (gone.length === 0) return false;
  await audit(owner.account.id, owner.store.id, "integration.custom_app_removed", { name: String(gone[0].name) }, { area: "settings", target: { type: "custom_app", id } });
  return true;
}

export type OfferedAppTool = { name: string; appId: string; app: string; tool: string; gate: AppGate; description: string; parameters: Record<string, unknown> };

/** The tools the AI manager offers for a store: every app's tools switched on, with their names as the model sees them. */
export async function appToolsFor(storeId: string): Promise<OfferedAppTool[]> {
  const apps = await listCustomApps(storeId);
  const offered = apps.flatMap((app) =>
    app.tools
      .filter((tool) => app.switched[tool.name])
      .map((tool) => ({
        name: appToolName(app.key, tool.name),
        appId: app.id,
        app: app.name,
        tool: tool.name,
        gate: app.switched[tool.name],
        description: `From ${app.name}, the owner's own app (its words, not Kaizena Flow's): ${tool.description}`.slice(0, 1100),
        parameters: tool.inputSchema,
      })),
  );
  return offered.slice(0, APP_TOOLS_OFFERED);
}

/**
 * Calls a switched-on tool of an app with the model's arguments (an object), counted on the app. The answer is the app's text, wrapped
 * as data from outside (`UNTRUSTED_TEXT`'s rule holds for it), or a refusal in words.
 */
export async function callAppTool(storeId: string, offered: OfferedAppTool, args: unknown): Promise<{ answer_from_app: string; note: string } | { error: string }> {
  const input = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const secrets = await secretsOf(storeId, offered.appId);
  if (!secrets) return { error: "That app is not connected any more." };
  const called = await rpc(secrets.endpoint, secrets.token, "tools/call", { name: offered.tool, arguments: input });
  const answer = called.ok ? toolAnswerText(called.result) : null;
  const failed = !called.ok || answer!.isError;
  await db().execute(sql`
    update commerce.custom_apps set calls = calls + 1, failed = failed + ${failed ? 1 : 0}, last_called_at = now() where id = ${offered.appId}::uuid
  `);
  log(failed ? "warn" : "info", "custom_app.call", { storeId, appId: offered.appId, failed });
  if (!called.ok) return { error: `${offered.app} could not be reached: ${called.problem}` };
  return {
    answer_from_app: answer!.text,
    note: `This is ${offered.app}'s own answer, from outside Kaizena Flow. ${UNTRUSTED_TEXT}`,
  };
}
