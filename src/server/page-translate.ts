import "server-only";

import { parseModelJson } from "@/lib/query-understanding";
import {
  batchItems,
  readTranslations,
  requestSize,
  translationMessages,
  TRANSLATE_MAX_CHARACTERS,
  type TranslateRequest,
  type Translated,
} from "@/lib/page-translate-ai";

import { AiError, completeText, type AiConnection } from "./ai";
import { audit } from "./auth";

/**
 * Translating a page with AI (D109): asks the owner's text model for each
 * batch of the page's texts and checks what comes back. Nothing is saved
 * here: the page builder puts the texts in the language's translation for
 * staff to read, change and save. A run is logged (who, how many texts,
 * which model), never the texts.
 */
export async function translatePageTexts(
  connection: AiConnection,
  who: { accountId: string; storeId: string | null },
  request: TranslateRequest,
): Promise<Translated & { model: string }> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  if (requestSize(request.items) > TRANSLATE_MAX_CHARACTERS) throw new AiError("The page has too much text to translate at once.");

  const result: Translated = { done: {}, skipped: [] };
  let answered = 0;
  let failure: AiError | null = null;
  // A few batches at a time: a long page is several replies, and each is a call to the model.
  const batches = batchItems(request.items);
  for (let start = 0; start < batches.length; start += 3) {
    await Promise.all(
      batches.slice(start, start + 3).map(async (batch) => {
        try {
          const reply = await completeText(connection, translationMessages(request.from, request.to, batch), {
            maxTokens: 6000,
            timeoutMs: 90_000,
            temperature: 0.2,
            reasoningEffort: "low",
          });
          const read = readTranslations(parseModelJson(reply.text), batch);
          Object.assign(result.done, read.done);
          result.skipped.push(...read.skipped);
          answered += 1;
        } catch (error) {
          if (!(error instanceof AiError)) throw error;
          failure = error;
          for (const item of batch) result.skipped.push({ key: item.key, label: item.label, reason: "The AI did not answer." });
        }
      }),
    );
  }
  // Nothing came back at all: say why, rather than an empty result.
  if (answered === 0 && failure) throw failure;

  await audit(who.accountId, who.storeId, "page.ai_translated", {
    from: request.from,
    to: request.to,
    texts: request.items.length,
    translated: Object.keys(result.done).length,
    model: connection.textModel,
    source: connection.source,
  });
  return { ...result, model: connection.textModel };
}
