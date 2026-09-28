import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import {
  aiProviderInput,
  apiBaseUrl,
  checkBaseUrl,
  embeddingSpace,
  keyHint,
  providerInfo,
  type AiProviderId,
  type ImageQuality,
} from "@/lib/ai-provider";
import { cosineSimilarity } from "@/lib/vectors";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

import { audit } from "./auth";
import { encryptionKey } from "./settings";

type Row = Record<string, unknown>;

/**
 * AI providers (D73): which provider and models Kaizen uses, and a small
 * client for their OpenAI-compatible API. Kaizen's row (`store_id` null) is
 * the default; a store's own row replaces it while on. Nothing else in
 * Kaizen names a provider or model: features call `aiFor(storeId)` and
 * pass the connection on, and must work without AI when it gives none or a
 * call fails.
 */

/** A provider's settings as the admin shows them: never the key. */
export type AiSettings = {
  storeId: string | null;
  provider: AiProviderId;
  baseUrl: string | null;
  apiKeyHint: string;
  embeddingModel: string | null;
  textModel: string | null;
  /** The chat agent's voice (D81): speech to text, text to speech and its voice; any unset turns voice off. */
  transcriptionModel: string | null;
  speechModel: string | null;
  speechVoice: string | null;
  /** Pictures (D92): the model, and another provider's (with its own key) or null for this one's. */
  imageModel: string | null;
  imageProvider: AiProviderId | null;
  imageBaseUrl: string | null;
  imageApiKeyHint: string | null;
  imageQuality: ImageQuality | null;
  minSimilarity: number;
  embeddingEuOnly: boolean;
  textEuOnly: boolean;
  zeroDataRetention: boolean;
  enabled: boolean;
  updatedAt: string;
};

/** Settings with the address and key to call: server only, never sent to a browser. */
export type AiConnection = AiSettings & {
  /** Whose settings these are: the store's own, or Kaizen's. */
  source: "store" | "platform";
  apiUrl: string;
  apiKey: string;
  /** Names the vectors this connection's embedding model makes (`embeddingSpace()`). */
  space: string | null;
  /** Where pictures are made (D92): this provider's address and key, or another's; null without a picture model. */
  image: ImageConnection | null;
};

/** A picture model and where to reach it. */
export type ImageConnection = { provider: AiProviderId; apiUrl: string; apiKey: string; model: string; quality: ImageQuality | null };

function toSettings(row: Row): AiSettings {
  return {
    storeId: row.store_id ? String(row.store_id) : null,
    provider: String(row.provider) as AiProviderId,
    baseUrl: row.base_url ? String(row.base_url) : null,
    apiKeyHint: String(row.api_key_hint),
    embeddingModel: row.embedding_model ? String(row.embedding_model) : null,
    textModel: row.text_model ? String(row.text_model) : null,
    transcriptionModel: row.transcription_model ? String(row.transcription_model) : null,
    speechModel: row.speech_model ? String(row.speech_model) : null,
    speechVoice: row.speech_voice ? String(row.speech_voice) : null,
    imageModel: row.image_model ? String(row.image_model) : null,
    imageProvider: row.image_provider ? (String(row.image_provider) as AiProviderId) : null,
    imageBaseUrl: row.image_base_url ? String(row.image_base_url) : null,
    imageApiKeyHint: row.image_api_key_hint ? String(row.image_api_key_hint) : null,
    imageQuality: row.image_quality ? (String(row.image_quality) as ImageQuality) : null,
    minSimilarity: Number(row.min_similarity),
    embeddingEuOnly: Boolean(row.embedding_eu_only),
    textEuOnly: Boolean(row.text_eu_only),
    zeroDataRetention: Boolean(row.zero_data_retention),
    enabled: Boolean(row.enabled),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

const owned = (storeId: string | null) =>
  storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`;

/** Kaizen's settings (null) or a store's own, as saved; null when none. */
export async function getAiSettings(storeId: string | null): Promise<AiSettings | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.ai_providers where ${owned(storeId)}`);
  return row ? toSettings(row) : null;
}

function toConnection(row: Row, source: AiConnection["source"]): AiConnection | null {
  const settings = toSettings(row);
  const key = encryptionKey();
  const apiUrl = apiBaseUrl(settings.provider, settings.baseUrl);
  if (!key || !apiUrl) return null;
  let apiKey: string;
  try {
    apiKey = decryptSecret(String(row.api_key_encrypted), key);
  } catch {
    return null;
  }
  const space = settings.embeddingModel ? embeddingSpace(settings.provider, settings.baseUrl, settings.embeddingModel) : null;
  return { ...settings, source, apiUrl, apiKey, space, image: imageConnection(row, settings, { apiUrl, apiKey }, key) };
}

/** Where the row's pictures are made: its own provider, or the other one it names with that one's key; null without a model. */
function imageConnection(row: Row, settings: AiSettings, own: { apiUrl: string; apiKey: string }, key: Buffer): ImageConnection | null {
  if (!settings.imageModel) return null;
  const quality = settings.imageQuality;
  if (!settings.imageProvider) return { provider: settings.provider, ...own, model: settings.imageModel, quality };
  const apiUrl = apiBaseUrl(settings.imageProvider, settings.imageBaseUrl);
  if (!apiUrl || !row.image_api_key_encrypted) return null;
  try {
    const apiKey = decryptSecret(String(row.image_api_key_encrypted), key);
    return { provider: settings.imageProvider, apiUrl, apiKey, model: settings.imageModel, quality };
  } catch {
    return null;
  }
}

/**
 * The AI a store uses: its own provider while that is on, else Kaizen's
 * while that is on; null means no AI (features fall back to what works
 * without it). With a null store, Kaizen's.
 */
export async function aiFor(storeId: string | null): Promise<AiConnection | null> {
  const rows = await readDb().execute<Row>(sql`
    select * from commerce.ai_providers
    where enabled and (store_id is null ${storeId ? sql`or store_id = ${storeId}::uuid` : sql``})
    order by store_id nulls last
  `);
  for (const row of rows) {
    const connection = toConnection(row, row.store_id ? "store" : "platform");
    if (connection) return connection;
  }
  return null;
}

/** Cached reads that depend on which AI a site has (the chat widget, D81); saving or removing a provider updates them. */
export const AI_TAG = "ai-providers";

export type SaveResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Saves Kaizen's provider (`storeId` null, platform admins) or a store's own
 * (owners). A new key replaces the saved one; left empty, the saved one
 * stays, unless the provider or its address changed, which needs a new key.
 */
export async function saveAiSettings(accountId: string, storeId: string | null, raw: unknown): Promise<SaveResult> {
  const parsed = aiProviderInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const input = parsed.data;
  const baseUrl = input.provider === "custom" ? (checkBaseUrl(input.baseUrl) as { ok: true; url: string }).url : null;
  const existing = await getAiSettings(storeId);
  const sameEndpoint = existing && existing.provider === input.provider && existing.baseUrl === baseUrl;
  let encrypted: string | null = null;
  let hint: string | null = null;
  if (input.apiKey) {
    const key = encryptionKey();
    if (!key) return { ok: false, problems: ["Kaizen cannot keep the key safe right now, so it was not saved. Try again later."] };
    encrypted = encryptSecret(input.apiKey, key);
    hint = keyHint(input.apiKey);
  } else if (!sameEndpoint) {
    return { ok: false, problems: [`Paste an API key for ${providerInfo(input.provider).name}.`] };
  }
  // Pictures from another provider (D92) take its own key, kept as the other: a new one replaces it; left empty, it stays while the provider does.
  const imageBaseUrl = input.imageProvider === "custom" ? (checkBaseUrl(input.imageBaseUrl) as { ok: true; url: string }).url : null;
  let imageEncrypted: string | null = null;
  let imageHint: string | null = null;
  if (input.imageProvider && input.imageApiKey) {
    const key = encryptionKey();
    if (!key) return { ok: false, problems: ["Kaizen cannot keep the key safe right now, so it was not saved. Try again later."] };
    imageEncrypted = encryptSecret(input.imageApiKey, key);
    imageHint = keyHint(input.imageApiKey);
  } else if (input.imageProvider && !(existing?.imageProvider === input.imageProvider && existing.imageBaseUrl === imageBaseUrl)) {
    return { ok: false, problems: [`Paste an API key for pictures from ${providerInfo(input.imageProvider).name}.`] };
  }

  await db().execute(sql`
    insert into commerce.ai_providers (
      store_id, provider, base_url, api_key_encrypted, api_key_hint, embedding_model, text_model,
      transcription_model, speech_model, speech_voice,
      image_model, image_provider, image_base_url, image_api_key_encrypted, image_api_key_hint, image_quality,
      min_similarity, embedding_eu_only, text_eu_only, zero_data_retention, enabled, updated_by
    ) values (
      ${storeId}::uuid, ${input.provider}, ${baseUrl}, ${encrypted ?? ""}, ${hint ?? ""}, ${input.embeddingModel}, ${input.textModel},
      ${input.transcriptionModel}, ${input.speechModel}, ${input.speechVoice},
      ${input.imageModel}, ${input.imageProvider}, ${imageBaseUrl},
      -- A kept key is carried into the row itself: the row's checks see it before the update does.
      case when ${input.imageProvider}::text is not null then coalesce(${imageEncrypted}::text, (select p.image_api_key_encrypted from commerce.ai_providers p where p.store_id is not distinct from ${storeId}::uuid)) end,
      case when ${input.imageProvider}::text is not null then coalesce(${imageHint}::text, (select p.image_api_key_hint from commerce.ai_providers p where p.store_id is not distinct from ${storeId}::uuid)) end,
      ${input.imageQuality},
      ${input.minSimilarity}, ${input.embeddingEuOnly}, ${input.textEuOnly}, ${input.zeroDataRetention}, ${input.enabled}, ${accountId}::uuid
    )
    on conflict (store_id) do update set
      provider = excluded.provider, base_url = excluded.base_url,
      api_key_encrypted = coalesce(nullif(excluded.api_key_encrypted, ''), ai_providers.api_key_encrypted),
      api_key_hint = coalesce(nullif(excluded.api_key_hint, ''), ai_providers.api_key_hint),
      embedding_model = excluded.embedding_model, text_model = excluded.text_model,
      transcription_model = excluded.transcription_model, speech_model = excluded.speech_model, speech_voice = excluded.speech_voice,
      image_model = excluded.image_model, image_provider = excluded.image_provider, image_base_url = excluded.image_base_url,
      image_api_key_encrypted = excluded.image_api_key_encrypted, image_api_key_hint = excluded.image_api_key_hint,
      image_quality = excluded.image_quality,
      min_similarity = excluded.min_similarity, embedding_eu_only = excluded.embedding_eu_only,
      text_eu_only = excluded.text_eu_only, zero_data_retention = excluded.zero_data_retention,
      enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(accountId, storeId, storeId ? "ai.saved" : "ai.platform_saved", {
    provider: input.provider,
    baseUrl,
    embeddingModel: input.embeddingModel,
    textModel: input.textModel,
    transcriptionModel: input.transcriptionModel,
    speechModel: input.speechModel,
    speechVoice: input.speechVoice,
    imageModel: input.imageModel,
    imageProvider: input.imageProvider,
    imageBaseUrl,
    imageQuality: input.imageQuality,
    minSimilarity: input.minSimilarity,
    enabled: input.enabled,
    newKey: Boolean(encrypted),
    newImageKey: Boolean(imageEncrypted),
  });
  return { ok: true };
}

/** Forgets a store's own provider (back to Kaizen's), or Kaizen's (no AI for stores without their own). */
export async function removeAiSettings(accountId: string, storeId: string | null): Promise<void> {
  const rows = await db().execute<Row>(sql`delete from commerce.ai_providers where ${owned(storeId)} returning provider`);
  if (rows.length > 0) await audit(accountId, storeId, storeId ? "ai.removed" : "ai.platform_removed", {});
}

/** How many stores use their own provider, for Kaizen's page. */
export async function countStoresWithOwnAi(): Promise<number> {
  const [row] = await readDb().execute<Row>(sql`select count(*)::int as n from commerce.ai_providers where store_id is not null and enabled`);
  return Number(row?.n ?? 0);
}

// The client --------------------------------------------------------------

/** A provider did not answer as asked; `status` is its HTTP status, when there was one. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const EU = { scope: "zone", geoRegion: "eu" } as const;

/** Vercel AI Gateway's options for a request: EU data centres and zero retention, as set. */
function gatewayOptions(connection: AiConnection, euOnly: boolean): Record<string, unknown> {
  if (!providerInfo(connection.provider).gateway) return {};
  const gateway: Record<string, unknown> = {};
  if (euOnly) gateway.inferenceRegion = EU;
  if (connection.zeroDataRetention) gateway.zeroDataRetention = true;
  return Object.keys(gateway).length > 0 ? { providerOptions: { gateway } } : {};
}

async function post(
  connection: Pick<AiConnection, "apiUrl" | "apiKey" | "provider">,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Row> {
  let response: Response;
  try {
    response = await fetch(`${connection.apiUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${connection.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      // A provider's address is set by an admin or a store owner: never follow it elsewhere.
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new AiError(timedOut ? `No answer within ${timeoutMs / 1000} seconds.` : "The provider could not be reached.");
  }
  const text = await response.text();
  let json: Row = {};
  try {
    json = JSON.parse(text) as Row;
  } catch {
    // Not JSON: the status says enough.
  }
  if (!response.ok) {
    const error = json.error as Row | string | undefined;
    const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : text.slice(0, 200);
    if (connection.provider === "openai_eu" && /geography restrictions/i.test(message)) {
      throw new AiError(
        "This key is from an OpenAI project without European data residency, and eu.api.openai.com takes keys only from one with it. Paste a key from an EU project, or choose OpenAI.",
        response.status,
      );
    }
    throw new AiError(message || `The provider answered ${response.status}.`, response.status);
  }
  return json;
}

/** Where a gateway request ran (`eu`, `us`), when the answer says. */
function servedRegion(json: Row | undefined): string | null {
  const gateway = ((json?.provider_metadata ?? json?.providerMetadata) as Row | undefined)?.gateway as Row | undefined;
  const attempts = ((gateway?.routing as Row | undefined)?.modelAttempts ?? []) as Row[];
  for (const attempt of attempts) {
    for (const provider of (attempt.providerAttempts ?? []) as Row[]) {
      const region = (provider.inferenceEndpoint as Row | null | undefined)?.geoRegion;
      if (typeof region === "string") return region;
    }
  }
  return null;
}

export type Embeddings = { vectors: number[][]; region: string | null };

/** Vectors for texts, in order, from the connection's embedding model. */
export async function embedTexts(connection: AiConnection, texts: string[], timeoutMs = 10_000): Promise<Embeddings> {
  if (!connection.embeddingModel) throw new AiError("No embedding model is set.");
  if (texts.length === 0) return { vectors: [], region: null };
  const json = await post(
    connection,
    "/embeddings",
    { model: connection.embeddingModel, input: texts, ...gatewayOptions(connection, connection.embeddingEuOnly) },
    timeoutMs,
  );
  const data = ((json.data ?? []) as Row[]).slice().sort((a, b) => Number(a.index) - Number(b.index));
  const vectors = data.map((item) => item.embedding as number[]);
  if (vectors.length !== texts.length || vectors.some((v) => !Array.isArray(v) || v.length === 0 || v.length !== vectors[0].length)) {
    throw new AiError("The provider's answer did not hold one vector per text.");
  }
  return { vectors, region: servedRegion(json) };
}

/** Tuning a text model may refuse, and which models refused which (per server instance). */
const TUNING = ["temperature", "reasoning_effort"];
const refusedTuning = new Map<string, Set<string>>();

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

/** Part of a message: words, or a picture for a model that sees them (D89), in the provider's own form (`imagePart()`). */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: string | { url: string } };

/**
 * A picture as part of a message, from its bytes as a `data:` address, so
 * the provider never fetches anything of ours. Mistral takes the address
 * itself; the others an object holding it.
 */
export function imagePart(connection: AiConnection, bytes: Uint8Array, contentType: string): ContentPart {
  const url = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  return { type: "image_url", image_url: connection.provider === "mistral" ? url : { url } };
}

/** A reply from the connection's text model, as plain text. */
export async function completeText(
  connection: AiConnection,
  messages: ChatMessage[],
  options: { maxTokens?: number; timeoutMs?: number; temperature?: number; reasoningEffort?: "low" } = {},
): Promise<{ text: string; region: string | null }> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const limit = options.maxTokens ?? 1000;
  // Tuning some models refuse (reasoning models take no temperature; others know no reasoning effort),
  // left out once refused, and remembered, so later calls ask once.
  const model = `${connection.apiUrl}|${connection.textModel}`;
  const refused = refusedTuning.get(model) ?? new Set<string>();
  const tuning: Record<string, unknown> = {
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.reasoningEffort === undefined ? {} : { reasoning_effort: options.reasoningEffort }),
  };
  for (const name of refused) delete tuning[name];
  const ask = () =>
    post(
      connection,
      "/chat/completions",
      {
        model: connection.textModel,
        messages,
        // OpenAI's newer models take only the second name; for reasoning models it counts their reasoning too.
        ...(connection.provider === "openai" || connection.provider === "openai_eu" ? { max_completion_tokens: limit } : { max_tokens: limit }),
        ...tuning,
        ...gatewayOptions(connection, connection.textEuOnly),
      },
      options.timeoutMs ?? 30_000,
    );
  let json: Row | null = null;
  while (!json) {
    try {
      json = await ask();
    } catch (error) {
      // Asked again without the tuning the model refused, rather than failing.
      const name = error instanceof AiError && error.status === 400 ? TUNING.find((n) => n in tuning && error.message.includes(n.split("_")[0])) : undefined;
      if (!name) throw error;
      delete tuning[name];
      refused.add(name);
      refusedTuning.set(model, refused);
    }
  }
  const choice = ((json.choices ?? []) as Row[])[0];
  const message = choice?.message as Row | undefined;
  if (typeof message?.content !== "string" || !message.content.trim()) {
    const cut = choice?.finish_reason === "length";
    throw new AiError(cut ? "The answer was cut off at its length limit." : "The provider's answer held no text.");
  }
  return { text: message.content, region: servedRegion(message) ?? servedRegion(json) };
}

// The chat agent (D81) ----------------------------------------------------

/** A message in a conversation with tools: the model may ask for tools, and each answer goes back as a `tool` message. */
export type ToolChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** A tool the model may call: its name, what it does, and its arguments as JSON Schema. */
export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };

/** One step of a conversation with tools: the model's text, or the tools it asks for. */
export async function chatWithTools(
  connection: AiConnection,
  messages: ToolChatMessage[],
  tools: ToolDefinition[],
  options: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const limit = options.maxTokens ?? 800;
  const json = await post(
    connection,
    "/chat/completions",
    {
      model: connection.textModel,
      messages,
      tools: tools.map((tool) => ({ type: "function", function: tool })),
      tool_choice: "auto",
      ...(connection.provider === "openai" || connection.provider === "openai_eu" ? { max_completion_tokens: limit } : { max_tokens: limit }),
      ...gatewayOptions(connection, connection.textEuOnly),
    },
    options.timeoutMs ?? 30_000,
  );
  const message = (((json.choices ?? []) as Row[])[0]?.message ?? {}) as Row;
  const toolCalls = ((message.tool_calls ?? []) as Row[])
    .filter((call) => (call.function as Row | undefined)?.name)
    .map((call, index) => ({
      id: String(call.id ?? `call-${index}`),
      type: "function" as const,
      function: { name: String((call.function as Row).name), arguments: String((call.function as Row).arguments ?? "{}") },
    }));
  const content = typeof message.content === "string" && message.content.trim() ? message.content : null;
  if (!content && toolCalls.length === 0) throw new AiError("The provider's answer held no text.");
  return { content, toolCalls };
}

/**
 * One step of a conversation with tools, streamed (D94): the text is handed
 * to `onText` as it comes, and the tools asked for are put together from
 * their pieces, so the answer is the same as `chatWithTools`'s.
 */
export async function streamWithTools(
  connection: AiConnection,
  messages: ToolChatMessage[],
  tools: ToolDefinition[],
  onText: (delta: string) => void,
  options: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const limit = options.maxTokens ?? 1200;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  let response: Response;
  try {
    response = await fetch(`${connection.apiUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${connection.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: connection.textModel,
        messages,
        ...(tools.length > 0 && { tools: tools.map((tool) => ({ type: "function", function: tool })), tool_choice: "auto" }),
        stream: true,
        ...(connection.provider === "openai" || connection.provider === "openai_eu" ? { max_completion_tokens: limit } : { max_tokens: limit }),
        ...gatewayOptions(connection, connection.textEuOnly),
      }),
      redirect: "error",
      signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
      cache: "no-store",
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new AiError("The provider could not be reached.");
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = text.slice(0, 200);
    try {
      const error = (JSON.parse(text) as Row).error as Row | string | undefined;
      message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : message;
    } catch {
      // Not JSON.
    }
    throw new AiError(message || `The provider answered ${response.status}.`, response.status);
  }
  let content = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      let chunk: Row;
      try {
        chunk = JSON.parse(data) as Row;
      } catch {
        continue;
      }
      const delta = (((chunk.choices ?? []) as Row[])[0]?.delta ?? {}) as Row;
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        onText(delta.content);
      }
      for (const call of (delta.tool_calls ?? []) as Row[]) {
        const index = Number(call.index ?? 0);
        const current = calls.get(index) ?? { id: "", name: "", args: "" };
        const fn = (call.function ?? {}) as Row;
        if (typeof call.id === "string" && call.id) current.id = call.id;
        if (typeof fn.name === "string") current.name += fn.name;
        if (typeof fn.arguments === "string") current.args += fn.arguments;
        calls.set(index, current);
      }
    }
  }
  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, call]) => call.name)
    .map(([index, call]) => ({ id: call.id || `call-${index}`, type: "function" as const, function: { name: call.name, arguments: call.args || "{}" } }));
  const text = content.trim() ? content : null;
  if (!text && toolCalls.length === 0) throw new AiError("The provider's answer held no text.");
  return { content: text, toolCalls };
}

/** Whether the connection can hear and speak: both voice models and a voice are set. */
export const canSpeak = (connection: AiConnection | null): connection is AiConnection =>
  Boolean(connection?.transcriptionModel && connection.speechModel && connection.speechVoice);

/** What a visitor said, written down by the connection's speech-to-text model. */
export async function transcribeAudio(connection: AiConnection, audio: Blob, fileName: string, language: string | null): Promise<string> {
  if (!connection.transcriptionModel) throw new AiError("No speech-to-text model is set.");
  const form = new FormData();
  form.set("model", connection.transcriptionModel);
  form.set("file", audio, fileName);
  form.set("response_format", "json");
  if (language) form.set("language", language);
  const response = await send(connection, "/audio/transcriptions", form, 30_000);
  const json = (await response.json().catch(() => ({}))) as Row;
  return typeof json.text === "string" ? json.text.trim() : "";
}

/** Text read out by the connection's text-to-speech model and voice, as MP3. */
export async function speakText(connection: AiConnection, text: string): Promise<ArrayBuffer> {
  if (!connection.speechModel || !connection.speechVoice) throw new AiError("No text-to-speech model or voice is set.");
  const response = await send(
    connection,
    "/audio/speech",
    JSON.stringify({ model: connection.speechModel, voice: connection.speechVoice, input: text, response_format: "mp3" }),
    30_000,
  );
  return response.arrayBuffer();
}

// Pictures (D92) -----------------------------------------------------------

/** A picture's shape; each model is asked for its nearest size. */
export type ImageShape = "landscape" | "portrait" | "square";
const IMAGE_SIZES: Record<ImageShape, string> = { landscape: "1536x1024", portrait: "1024x1536", square: "1024x1024" };
/** Options a picture model may refuse, and which models refused which (per server instance), as for text. */
const IMAGE_OPTIONS = ["size", "quality"];
const refusedImageOptions = new Map<string, Set<string>>();
/** The largest picture taken from a provider. */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * A picture made by the connection's picture model from a description,
 * through the OpenAI-compatible `/images/generations` that OpenAI and
 * others offer: its bytes, whatever their format. The model is only a
 * name in the settings, so a better one needs no change here; a size or
 * quality it does not take is left out and remembered.
 */
export async function generateImage(
  connection: AiConnection,
  prompt: string,
  options: { shape?: ImageShape; timeoutMs?: number } = {},
): Promise<{ bytes: Uint8Array }> {
  const image = connection.image;
  if (!image) throw new AiError("No picture model is set.");
  const model = `${image.apiUrl}|${image.model}`;
  const refused = refusedImageOptions.get(model) ?? new Set<string>();
  const extra: Record<string, unknown> = {
    size: IMAGE_SIZES[options.shape ?? "landscape"],
    ...(image.quality ? { quality: image.quality } : {}),
  };
  for (const name of refused) delete extra[name];
  let json: Row | null = null;
  while (!json) {
    try {
      json = await post(image, "/images/generations", { model: image.model, prompt: prompt.slice(0, 4000), n: 1, ...extra }, options.timeoutMs ?? 150_000);
    } catch (error) {
      const name = error instanceof AiError && error.status === 400 ? IMAGE_OPTIONS.find((n) => n in extra && error.message.toLowerCase().includes(n)) : undefined;
      if (!name) throw error;
      delete extra[name];
      refused.add(name);
      refusedImageOptions.set(model, refused);
    }
  }
  const first = ((json.data ?? []) as Row[])[0];
  if (typeof first?.b64_json === "string" && first.b64_json) {
    const bytes = new Uint8Array(Buffer.from(first.b64_json, "base64"));
    if (bytes.byteLength > IMAGE_MAX_BYTES) throw new AiError("The picture was too large.");
    return { bytes };
  }
  // Some models answer with an address to fetch the picture from, for a short while.
  if (typeof first?.url === "string" && first.url.startsWith("https://")) {
    let response: Response;
    try {
      response = await fetch(first.url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    } catch {
      throw new AiError("The picture could not be fetched from the provider.");
    }
    if (!response.ok) throw new AiError(`The picture could not be fetched from the provider (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) throw new AiError("The picture was empty or too large.");
    return { bytes };
  }
  throw new AiError("The provider's answer held no picture.");
}

/** A request whose answer is not JSON (audio) or whose body is a form (a recording). */
async function send(connection: AiConnection, path: string, body: FormData | string, timeoutMs: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${connection.apiUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${connection.apiKey}`, ...(typeof body === "string" ? { "content-type": "application/json" } : {}) },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new AiError(timedOut ? `No answer within ${timeoutMs / 1000} seconds.` : "The provider could not be reached.");
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text.slice(0, 200);
    try {
      const error = (JSON.parse(text) as Row).error as Row | string | undefined;
      message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : message;
    } catch {
      // Not JSON: the start of the text says enough.
    }
    throw new AiError(message || `The provider answered ${response.status}.`, response.status);
  }
  return response;
}

// Testing from the admin -------------------------------------------------

export type AiTestPart = { ok: boolean; message: string };
export type AiTest = { embedding: AiTestPart | null; text: AiTestPart | null };

/** Texts to compare: a query, a product it should find, and one it should not. */
const PROBE = ["kopp til kaffe", "Keramikkopp i steingods, tåler oppvaskmaskin", "Sykkelhjelm med lys, str. M"];

const where = (region: string | null) => (region ? ` Ran in: ${region.toUpperCase()}.` : "");
const failed = (error: unknown) =>
  error instanceof AiError
    ? `${error.status ? `${error.status}: ` : ""}${error.message}`
    : "Something went wrong. Try again.";

/**
 * Tries both models with the saved settings. The embedding test also
 * shows how similar a matching and a non-matching product come out, which
 * is where the similarity limit belongs: between the two.
 */
export async function testAi(connection: AiConnection): Promise<AiTest> {
  const [embedding, text] = await Promise.all([
    connection.embeddingModel
      ? (async (): Promise<AiTestPart> => {
          const started = Date.now();
          try {
            const { vectors, region } = await embedTexts(connection, PROBE);
            const match = cosineSimilarity(vectors[0], vectors[1]);
            const other = cosineSimilarity(vectors[0], vectors[2]);
            return {
              ok: true,
              message:
                `${connection.embeddingModel} answered in ${Date.now() - started} ms with ${vectors[0].length} numbers per text.` +
                ` A matching product scored ${match.toFixed(2)}, an unrelated one ${other.toFixed(2)}` +
                ` (limit ${connection.minSimilarity.toFixed(2)}).${where(region)}`,
            };
          } catch (error) {
            return { ok: false, message: `${connection.embeddingModel}: ${failed(error)}` };
          }
        })()
      : null,
    connection.textModel
      ? (async (): Promise<AiTestPart> => {
          const started = Date.now();
          try {
            const reply = await completeText(connection, [{ role: "user", content: "Reply with the single word OK." }], {
              maxTokens: 20,
            });
            return {
              ok: true,
              message: `${connection.textModel} answered in ${Date.now() - started} ms: “${reply.text.trim().slice(0, 40)}”.${where(reply.region)}`,
            };
          } catch (error) {
            return { ok: false, message: `${connection.textModel}: ${failed(error)}` };
          }
        })()
      : null,
  ]);
  return { embedding, text };
}

/** The saved settings of Kaizen (null) or a store, ready to test; null when none can be used. */
export async function ownConnection(storeId: string | null): Promise<AiConnection | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.ai_providers where ${owned(storeId)}`);
  return row ? toConnection(row, storeId ? "store" : "platform") : null;
}
