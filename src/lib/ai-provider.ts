/**
 * AI providers (D73). Kaizen talks to every provider through the same
 * OpenAI-compatible API (`/embeddings`, `/chat/completions`), so a provider
 * is only an address, a key and model names. Kaizen chooses one for all
 * stores; a store's owner may choose their own instead. Shared with the
 * browser: no secrets here.
 */

export const AI_PROVIDER_IDS = ["gateway", "mistral", "openai", "openai_eu", "google", "custom"] as const;
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
  /**
   * Models that take pictures as input (D163), best first, each with what it is good for: offered next to the vision field as
   * one-press choices. Only a start: any model can be typed, and "Check that it sees pictures" is what shows whether one does.
   */
  visionModels: { model: string; note: string }[];
  /** The chat agent's voice (D81): speech to text, text to speech, and its voices. */
  transcriptionModels: string[];
  speechModels: string[];
  voices: string[];
  /**
   * Picture models (D92), newest first, as suggestions: any the provider
   * offers through `/images/generations` can be typed, so a better one is a
   * new name in the settings.
   */
  imageModels: string[];
  /**
   * Live voice models (D105), full duplex through `/live/sessions` over
   * WebRTC, and their voices, as suggestions: a newer one is a new name in
   * the settings.
   */
  liveModels: string[];
  liveVoices: string[];
  /** Vercel AI Gateway takes EU-only and zero-retention options per request. */
  gateway: boolean;
};

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: "gateway",
    name: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    keysUrl: "https://vercel.com/docs/ai-gateway/authentication-and-byok",
    embeddingModels: ["mistral/mistral-embed", "openai/text-embedding-3-small", "google/text-multilingual-embedding-002"],
    textModels: ["anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-5", "google/gemini-2.5-flash"],
    visionModels: [{ model: "anthropic/claude-haiku-4.5", note: "Quick and cheap" }, { model: "anthropic/claude-sonnet-5", note: "Most careful, for copying pages" }, { model: "google/gemini-2.5-flash", note: "Quick and cheap" }],
    transcriptionModels: [],
    speechModels: [],
    voices: [],
    imageModels: [],
    liveModels: [],
    liveVoices: [],
    gateway: true,
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    keysUrl: "https://console.mistral.ai/api-keys",
    embeddingModels: ["mistral-embed"],
    textModels: ["mistral-small-latest", "mistral-medium-latest"],
    visionModels: [{ model: "mistral-small-latest", note: "Quick and cheap" }, { model: "mistral-medium-latest", note: "More careful" }],
    transcriptionModels: [],
    speechModels: [],
    voices: [],
    imageModels: [],
    liveModels: [],
    liveVoices: [],
    gateway: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keysUrl: "https://platform.openai.com/api-keys",
    embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"],
    textModels: ["gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4.1-nano"],
    visionModels: [{ model: "gpt-5-mini", note: "Balanced" }, { model: "gpt-4.1-mini", note: "Quick and cheap" }, { model: "gpt-5-nano", note: "Cheapest" }],
    transcriptionModels: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
    speechModels: ["gpt-4o-mini-tts", "tts-1"],
    voices: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"],
    imageModels: ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
    liveModels: ["gpt-live-1"],
    liveVoices: ["marin", "cedar", "coral", "sage", "ballad", "verse", "ash", "alloy", "echo", "shimmer"],
    gateway: false,
  },
  {
    id: "openai_eu",
    name: "OpenAI (EU data residency)",
    // Only for an OpenAI project created with European data residency: processed and kept in the EU.
    baseUrl: "https://eu.api.openai.com/v1",
    keysUrl: "https://platform.openai.com/docs/guides/your-data#data-residency-controls",
    embeddingModels: ["text-embedding-3-small", "text-embedding-3-large"],
    textModels: ["gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4.1-nano"],
    visionModels: [{ model: "gpt-5-mini", note: "Balanced" }, { model: "gpt-4.1-mini", note: "Quick and cheap" }, { model: "gpt-5-nano", note: "Cheapest" }],
    transcriptionModels: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
    speechModels: ["gpt-4o-mini-tts", "tts-1"],
    voices: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"],
    imageModels: ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
    liveModels: ["gpt-live-1"],
    liveVoices: ["marin", "cedar", "coral", "sage", "ballad", "verse", "ash", "alloy", "echo", "shimmer"],
    gateway: false,
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keysUrl: "https://aistudio.google.com/apikey",
    embeddingModels: ["gemini-embedding-001"],
    textModels: ["gemini-2.5-flash"],
    visionModels: [{ model: "gemini-2.5-flash", note: "Quick and cheap" }],
    transcriptionModels: [],
    speechModels: [],
    voices: [],
    imageModels: [],
    liveModels: [],
    liveVoices: [],
    gateway: false,
  },
  {
    id: "custom",
    name: "Another OpenAI-compatible API",
    baseUrl: null,
    keysUrl: null,
    embeddingModels: [],
    textModels: [],
    visionModels: [],
    transcriptionModels: [],
    speechModels: [],
    voices: [],
    imageModels: [],
    liveModels: [],
    liveVoices: [],
    gateway: false,
  },
];

export function providerInfo(id: AiProviderId): AiProviderInfo {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[AI_PROVIDERS.length - 1];
}

/**
 * Where to start: results by meaning are left out below this similarity.
 * Measured with OpenAI's text-embedding-3-small on the demo store, searches
 * that fit came out at 0.33 to 0.55 and nonsense at 0.16; other models
 * score differently, which Test shows.
 */
export const DEFAULT_MIN_SIMILARITY = 0.3;

export type CheckedUrl = { ok: true; url: string } | { ok: false; problem: string };

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
    return { ok: false, problem: "Enter the API's full address, starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, problem: "The address must start with https://." };
  if (url.username || url.password) return { ok: false, problem: "Put the key in the key field, not in the address." };
  if (url.port) return { ok: false, problem: "The address cannot name a port." };
  if (url.search || url.hash) return { ok: false, problem: "The address cannot have ? or # in it." };
  const host = url.hostname.toLowerCase();
  const ip = /^[\d.]+$/.test(host) || host.startsWith("[");
  const local = host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes(".");
  if (ip || local) return { ok: false, problem: "Use the provider's public address, not an IP address or a local name." };
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${url.origin}${path}` };
}

/** The address requests go to. */
/** OpenAI's gpt-image models make pictures and also edit them (`/images/edits`), and can leave a background transparent. */
export const isGptImage = (model: string | null | undefined): boolean => Boolean(model && /^gpt-image/i.test(model.trim()));

/**
 * The model a site's pictures are edited with (D349, D413): the one chosen as *Model that edits pictures*, else the picture model where that one
 * edits too (OpenAI's gpt-image models at OpenAI), so a site that makes pictures with one can also take a background away without a second setting.
 */
export function pictureEditModel(provider: AiProviderId, imageModel: string | null, editModel: string | null): string | null {
  if (editModel) return editModel;
  return (provider === "openai" || provider === "openai_eu") && isGptImage(imageModel) ? imageModel : null;
}

export function apiBaseUrl(provider: AiProviderId, customUrl: string | null): string | null {
  return provider === "custom" ? customUrl : providerInfo(provider).baseUrl;
}

/**
 * Names the space a model's vectors live in, so vectors made by one model
 * are never compared with another's: changing the model re-embeds.
 */
export function embeddingSpace(provider: AiProviderId, customUrl: string | null, model: string): string {
  const base = apiBaseUrl(provider, customUrl) ?? "";
  return `${base.replace(/^https:\/\//, "")}|${model}`;
}

/** A masked key safe to show again: `…a1b2`. */
export function keyHint(key: string): string {
  return `…${key.trim().slice(-4)}`;
}

/** How much care a picture model takes, where it takes one (OpenAI's do): none leaves it to the model. */
export const IMAGE_QUALITIES = { auto: "The model's choice", low: "Low (fast, cheap)", medium: "Medium", high: "High (slow)" } as const;
export type ImageQuality = keyof typeof IMAGE_QUALITIES;

/** Reads the settings form into what `aiProviderInput` checks. */
export function aiFormValues(formData: FormData) {
  return {
    provider: String(formData.get("provider") ?? ""),
    baseUrl: String(formData.get("baseUrl") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
    embeddingModel: String(formData.get("embeddingModel") ?? ""),
    textModel: String(formData.get("textModel") ?? ""),
    visionModel: String(formData.get("visionModel") ?? ""),
    transcriptionModel: String(formData.get("transcriptionModel") ?? ""),
    speechModel: String(formData.get("speechModel") ?? ""),
    speechVoice: String(formData.get("speechVoice") ?? ""),
    imageModel: String(formData.get("imageModel") ?? ""),
    imageProvider: String(formData.get("imageProvider") ?? ""),
    imageBaseUrl: String(formData.get("imageBaseUrl") ?? ""),
    imageApiKey: String(formData.get("imageApiKey") ?? ""),
    imageQuality: String(formData.get("imageQuality") ?? ""),
    imageEditModel: String(formData.get("imageEditModel") ?? ""),
    liveModel: String(formData.get("liveModel") ?? ""),
    liveVoice: String(formData.get("liveVoice") ?? ""),
    liveProvider: String(formData.get("liveProvider") ?? ""),
    liveBaseUrl: String(formData.get("liveBaseUrl") ?? ""),
    liveApiKey: String(formData.get("liveApiKey") ?? ""),
    minSimilarity: String(formData.get("minSimilarity") ?? DEFAULT_MIN_SIMILARITY),
    embeddingEuOnly: formData.get("embeddingEuOnly") === "on",
    textEuOnly: formData.get("textEuOnly") === "on",
    zeroDataRetention: formData.get("zeroDataRetention") === "on",
    fallbackModels: String(formData.get("fallbackModels") ?? ""),
    enabled: formData.get("enabled") === "on",
  };
}
