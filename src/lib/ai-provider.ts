import { z } from "zod";

/**
 * AI providers (D73). Kaizen talks to every provider through the same
 * OpenAI-compatible API (`/embeddings`, `/chat/completions`), so a provider
 * is only an address, a key and model names. Kaizen chooses one for all
 * stores; a store's owner may choose their own instead. Shared with the
 * browser: no secrets here.
 */

export const AI_PROVIDER_IDS = [
  "gateway",
  "mistral",
  "openai",
  "openai_eu",
  "google",
  "custom",
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderInfo = {
  id: AiProviderId;
  name: string;
  /** The API's address; `custom` gives its own. */
  baseUrl: string | null;
  /** Where to make a key. */
  keysUrl: string | null;
  /** Model names to start from; any the provider offers can be typed. */
  embeddingModels: string[];
  textModels: string[];
  /** Vercel AI Gateway takes EU-only and zero-retention options per request. */
  gateway: boolean;
  /** Providers whose keys work for each other (`keepsKey()`); otherwise the provider's own id. */
  keyFamily?: string;
};

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: "gateway",
    name: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    keysUrl: "https://vercel.com/docs/ai-gateway/authentication-and-byok",
    embeddingModels: [
      "mistral/mistral-embed",
      "openai/text-embedding-3-small",
      "google/text-multilingual-embedding-002",
    ],
    textModels: [
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-sonnet-5",
      "google/gemini-2.5-flash",
    ],
    gateway: true,
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    keysUrl: "https://console.mistral.ai/api-keys",
    embeddingModels: ["mistral-embed"],
    textModels: ["mistral-small-latest", "mistral-medium-latest"],
    gateway: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keysUrl: "https://platform.openai.com/api-keys",
    embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"],
    textModels: ["gpt-5-mini"],
    gateway: false,
    keyFamily: "openai",
  },
  {
    id: "openai_eu",
    name: "OpenAI (EU data residency)",
    // Processed and kept in the EU with a key from a project created with European data residency.
    // An OpenAI key saved before carries over for now (keyFamily); Test shows whether this address takes it.
    baseUrl: "https://eu.api.openai.com/v1",
    keysUrl:
      "https://platform.openai.com/docs/guides/your-data#data-residency-controls",
    embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"],
    textModels: ["gpt-5-mini"],
    gateway: false,
    keyFamily: "openai",
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keysUrl: "https://aistudio.google.com/apikey",
    embeddingModels: ["gemini-embedding-001"],
    textModels: ["gemini-2.5-flash"],
    gateway: false,
  },
  {
    id: "custom",
    name: "Another OpenAI-compatible API",
    baseUrl: null,
    keysUrl: null,
    embeddingModels: [],
    textModels: [],
    gateway: false,
  },
];

export function providerInfo(id: AiProviderId): AiProviderInfo {
  return (
    AI_PROVIDERS.find((p) => p.id === id) ??
    AI_PROVIDERS[AI_PROVIDERS.length - 1]
  );
}

/**
 * Whether a key saved for one provider (and custom address) is kept when
 * switching to another: the same provider and address, or providers whose
 * keys work for each other, such as OpenAI and OpenAI (EU data residency).
 */
export function keepsKey(
  saved: { provider: AiProviderId; baseUrl: string | null },
  next: { provider: AiProviderId; baseUrl: string | null },
): boolean {
  const family = (id: AiProviderId) => providerInfo(id).keyFamily ?? id;
  return (
    family(saved.provider) === family(next.provider) &&
    (next.provider !== "custom" || saved.baseUrl === next.baseUrl)
  );
}

/**
 * Where to start: results by meaning are left out below this similarity.
 * Measured with OpenAI's text-embedding-3-small on the demo store, searches
 * that fit came out at 0.33 to 0.55 and nonsense at 0.16; other models
 * score differently, which Test shows.
 */
export const DEFAULT_MIN_SIMILARITY = 0.3;

export type CheckedUrl =
  | { ok: true; url: string }
  | { ok: false; problem: string };

/**
 * A custom provider's address. The server calls it with the key, so only
 * public https addresses are taken (no IP addresses, local names or ports),
 * and the server never follows redirects from it.
 */
export function checkBaseUrl(input: string): CheckedUrl {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      ok: false,
      problem: "Enter the API's full address, starting with https://.",
    };
  }
  if (url.protocol !== "https:")
    return { ok: false, problem: "The address must start with https://." };
  if (url.username || url.password)
    return {
      ok: false,
      problem: "Put the key in the key field, not in the address.",
    };
  if (url.port)
    return { ok: false, problem: "The address cannot name a port." };
  if (url.search || url.hash)
    return { ok: false, problem: "The address cannot have ? or # in it." };
  const host = url.hostname.toLowerCase();
  const ip = /^[\d.]+$/.test(host) || host.startsWith("[");
  const local =
    host === "localhost" ||
    /\.(localhost|local|internal|lan|home|corp)$/.test(host) ||
    !host.includes(".");
  if (ip || local)
    return {
      ok: false,
      problem:
        "Use the provider's public address, not an IP address or a local name.",
    };
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${url.origin}${path}` };
}

/** The address requests go to. */
export function apiBaseUrl(
  provider: AiProviderId,
  customUrl: string | null,
): string | null {
  return provider === "custom" ? customUrl : providerInfo(provider).baseUrl;
}

/**
 * Names the space a model's vectors live in, so vectors made by one model
 * are never compared with another's: changing the model re-embeds.
 */
export function embeddingSpace(
  provider: AiProviderId,
  customUrl: string | null,
  model: string,
): string {
  const base = apiBaseUrl(provider, customUrl) ?? "";
  return `${base.replace(/^https:\/\//, "")}|${model}`;
}

/** A masked key safe to show again: `…a1b2`. */
export function keyHint(key: string): string {
  return `…${key.trim().slice(-4)}`;
}

const modelName = z
  .string()
  .trim()
  .max(200, "A model name is at most 200 characters.")
  .regex(
    /^[\w.:/@+-]*$/,
    "A model name has only letters, digits and . : / @ + - _.",
  )
  .transform((value) => value || null);

/** What the settings form sends; the key may be left empty to keep the one saved. */
export const aiProviderInput = z
  .object({
    provider: z.enum(AI_PROVIDER_IDS, { error: "Choose a provider." }),
    baseUrl: z.string().trim().max(300).default(""),
    apiKey: z.string().trim().max(500, "That key is too long.").default(""),
    embeddingModel: modelName,
    textModel: modelName,
    minSimilarity: z.coerce
      .number({ error: "The similarity is a number from 0 to 1." })
      .min(0, "The similarity is a number from 0 to 1.")
      .max(1, "The similarity is a number from 0 to 1."),
    embeddingEuOnly: z.boolean(),
    textEuOnly: z.boolean(),
    zeroDataRetention: z.boolean(),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "custom") {
      const checked = checkBaseUrl(value.baseUrl);
      if (!checked.ok)
        ctx.addIssue({
          code: "custom",
          message: checked.problem,
          path: ["baseUrl"],
        });
    }
    if (!value.embeddingModel && !value.textModel) {
      ctx.addIssue({
        code: "custom",
        message: "Name at least one model.",
        path: ["embeddingModel"],
      });
    }
  });

export type AiProviderInput = z.infer<typeof aiProviderInput>;

/** Reads the settings form into what `aiProviderInput` checks. */
export function aiFormValues(formData: FormData) {
  return {
    provider: String(formData.get("provider") ?? ""),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
    embeddingModel: String(formData.get("embeddingModel") ?? ""),
    textModel: String(formData.get("textModel") ?? ""),
    minSimilarity: String(
      formData.get("minSimilarity") ?? DEFAULT_MIN_SIMILARITY,
    ),
    embeddingEuOnly: formData.get("embeddingEuOnly") === "on",
    textEuOnly: formData.get("textEuOnly") === "on",
    zeroDataRetention: formData.get("zeroDataRetention") === "on",
    enabled: formData.get("enabled") === "on",
  };
}
