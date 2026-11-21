import { z } from "zod";

import { AI_PROVIDER_IDS, IMAGE_QUALITIES, type ImageQuality, checkBaseUrl } from "./ai-provider";

/**
 * The schemas of ai-provider.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; ai-provider.ts imports it as a type alone.
 */

const modelName = z
  .string()
  .trim()
  .max(200, "A model name is at most 200 characters.")
  .regex(/^[\w.:/@+-]*$/, "A model name has only letters, digits and . : / @ + - _.")
  .transform((value) => value || null);

/** What the settings form sends; the key may be left empty to keep the one saved. */
export const aiProviderInput = z
  .object({
    provider: z.enum(AI_PROVIDER_IDS, { error: "Choose a provider." }),
    baseUrl: z.string().trim().max(300).default(""),
    apiKey: z.string().trim().max(500, "That key is too long.").default(""),
    embeddingModel: modelName,
    textModel: modelName,
    // The model that looks at pictures (D163): optional; empty uses the text model.
    visionModel: z.string().default("").pipe(modelName),
    // The voice (D81) is optional: forms and callers without it keep voice off.
    transcriptionModel: z.string().default("").pipe(modelName),
    speechModel: z.string().default("").pipe(modelName),
    speechVoice: z
      .string()
      .default("")
      .pipe(
        z
          .string()
          .trim()
          .max(100, "A voice's name is at most 100 characters.")
          .regex(/^[\w.:/@+-]*$/, "A voice's name has only letters, digits and . : / @ + - _.")
          .transform((value) => value || null),
      ),
    // Pictures (D92): optional, like the voice; another provider needs its own key.
    imageModel: z.string().default("").pipe(modelName),
    imageProvider: z
      .string()
      .default("")
      .pipe(z.union([z.literal("").transform(() => null), z.enum(AI_PROVIDER_IDS, { error: "Choose where pictures come from." })])),
    imageBaseUrl: z.string().trim().max(300).default(""),
    imageApiKey: z.string().trim().max(500, "That key is too long.").default(""),
    imageQuality: z
      .string()
      .default("")
      .pipe(
        z.union([
          z.literal("").transform(() => null),
          z.enum(Object.keys(IMAGE_QUALITIES) as [ImageQuality, ...ImageQuality[]], { error: "Choose a picture quality." }),
        ]),
      ),
    // Editing pictures (D349): a model at the picture provider, optional.
    imageEditModel: z.string().default("").pipe(modelName),
    // Live voice (D105): optional, like pictures; another provider needs its own key.
    liveModel: z.string().default("").pipe(modelName),
    liveVoice: z
      .string()
      .default("")
      .pipe(
        z
          .string()
          .trim()
          .max(100, "A voice's name is at most 100 characters.")
          .regex(/^[\w.:/@+-]*$/, "A voice's name has only letters, digits and . : / @ + - _.")
          .transform((value) => value || null),
      ),
    liveProvider: z
      .string()
      .default("")
      .pipe(z.union([z.literal("").transform(() => null), z.enum(AI_PROVIDER_IDS, { error: "Choose where the live voice comes from." })])),
    liveBaseUrl: z.string().trim().max(300).default(""),
    liveApiKey: z.string().trim().max(500, "That key is too long.").default(""),
    minSimilarity: z.coerce
      .number({ error: "The similarity is a number from 0 to 1." })
      .min(0, "The similarity is a number from 0 to 1.")
      .max(1, "The similarity is a number from 0 to 1."),
    embeddingEuOnly: z.boolean(),
    textEuOnly: z.boolean(),
    zeroDataRetention: z.boolean(),
    fallbackModels: z
      .string()
      .default("")
      .transform((text) => [...new Set(text.split(/[\s,]+/).map((m) => m.trim()).filter(Boolean))])
      .pipe(
        z
          .array(z.string().max(100).regex(/^[\w.-]+\/[\w.:-]+$/, "A fallback model is written provider/model, such as anthropic/claude-sonnet-5."))
          .max(3, "Name at most three fallback models."),
      ),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "custom") {
      const checked = checkBaseUrl(value.baseUrl);
      if (!checked.ok) ctx.addIssue({ code: "custom", message: checked.problem, path: ["baseUrl"] });
    }
    if (value.imageProvider === "custom") {
      const checked = checkBaseUrl(value.imageBaseUrl);
      if (!checked.ok) ctx.addIssue({ code: "custom", message: `Pictures: ${checked.problem}`, path: ["imageBaseUrl"] });
    }
    if (value.imageProvider && !value.imageModel) {
      ctx.addIssue({ code: "custom", message: "Name the picture model to use with the other provider.", path: ["imageModel"] });
    }
    if (value.liveProvider === "custom") {
      const checked = checkBaseUrl(value.liveBaseUrl);
      if (!checked.ok) ctx.addIssue({ code: "custom", message: `Live voice: ${checked.problem}`, path: ["liveBaseUrl"] });
    }
    if (value.liveProvider && !value.liveModel) {
      ctx.addIssue({ code: "custom", message: "Name the live voice model to use with the other provider.", path: ["liveModel"] });
    }
    if (!value.embeddingModel && !value.textModel) {
      ctx.addIssue({ code: "custom", message: "Name at least one model.", path: ["embeddingModel"] });
    }
  });
