/**
 * A custom app's tools for the AI manager (wave 9 unit J, D363, `docs/wave-9-platform.md` section 3, J), the pure part: an app's own MCP
 * endpoint lists tools (`tools/list`), the owner switches some on, each read-only or behind one of the AI manager's gates, and the AI manager
 * offers them as `app__{app}__{tool}`. What the app answers is data from outside, never instructions: only its text is kept, cut short.
 */

export const APP_TOOL_PREFIX = "app__";
export const APPS_MAX = 5;
export const APP_TOOLS_MAX = 50;
/** An app's answer the model reads, at most this many characters. */
export const APP_ANSWER_MAX = 8000;
export const APP_CALL_MS = 10_000;
/** App tools offered in one turn, at most (the providers take 128 tools in all). */
export const APP_TOOLS_OFFERED = 20;

/** How a switched-on tool runs: `read` at once, else kept for the person's yes under that gate. */
export const APP_GATES = ["read", "public", "send", "spend"] as const;
export type AppGate = (typeof APP_GATES)[number];
export const isAppGate = (value: unknown): value is AppGate => (APP_GATES as readonly unknown[]).includes(value);

export type AppTool = { name: string; description: string; inputSchema: Record<string, unknown> };

/** An app's key in its tools' names: its name in lower case letters, digits and hyphens, at most 16. */
export function appKey(name: string): string {
  const key = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16)
    .replace(/-+$/g, "");
  return key || "app";
}

/** The name the AI manager knows a tool by, at most 64 characters of letters, digits, `_` and `-` (what providers take). */
export function appToolName(key: string, tool: string): string {
  return `${APP_TOOL_PREFIX}${key}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

export const isAppToolName = (name: string): boolean => name.startsWith(APP_TOOL_PREFIX);

const TOOL_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The tools an MCP `tools/list` result names, cleaned: a name of its own shape, a description cut short, an object schema of a sane size. */
export function readToolList(result: unknown): AppTool[] {
  const tools = plain(result) && Array.isArray(result.tools) ? result.tools : [];
  const out: AppTool[] = [];
  const seen = new Set<string>();
  for (const raw of tools) {
    if (!plain(raw) || typeof raw.name !== "string" || !TOOL_NAME.test(raw.name) || seen.has(raw.name)) continue;
    const schema = plain(raw.inputSchema) && raw.inputSchema.type === "object" ? raw.inputSchema : { type: "object", properties: {} };
    if (JSON.stringify(schema).length > 20_000) continue;
    seen.add(raw.name);
    out.push({ name: raw.name, description: typeof raw.description === "string" ? raw.description.slice(0, 1000) : "", inputSchema: schema });
    if (out.length >= APP_TOOLS_MAX) break;
  }
  return out;
}

/** A JSON-RPC answer from an MCP endpoint, as JSON or as server-sent events (the last message with an `id`). */
export function readRpcAnswer(body: string, contentType: string): { result?: unknown; error?: { message: string } } | null {
  const parse = (text: string): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(text);
      return plain(value) ? value : null;
    } catch {
      return null;
    }
  };
  let message: Record<string, unknown> | null = null;
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = parse(line.slice(5).trim());
      if (data && "id" in data) message = data;
    }
  } else message = parse(body);
  if (!message) return null;
  if (plain(message.error)) return { error: { message: String(message.error.message ?? "error").slice(0, 300) } };
  return { result: message.result };
}

/** What a `tools/call` result says, as text only (pictures and other kinds are named, never passed on), cut to `APP_ANSWER_MAX`. */
export function toolAnswerText(result: unknown): { text: string; isError: boolean } {
  const content = plain(result) && Array.isArray(result.content) ? result.content : [];
  const parts = content.map((part) => (plain(part) && part.type === "text" && typeof part.text === "string" ? part.text : plain(part) ? `[${String(part.type ?? "content")}]` : ""));
  const text = parts.join("\n").trim();
  return { text: text.length > APP_ANSWER_MAX ? `${text.slice(0, APP_ANSWER_MAX)}…` : text, isError: plain(result) && result.isError === true };
}
