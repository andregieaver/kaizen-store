import "server-only";

import { parseModelJson } from "@/lib/query-understanding";
import { cleanWritten, writingMessages, type WriteRequest, type WrittenText } from "@/lib/product-writing";

import { AiError, completeText, type AiConnection } from "./ai";
import { audit } from "./auth";

/**
 * AI product texts (D76): asks the store's text model for a suggestion and
 * cleans it to plain text. Staff decide what to do with it in the editor;
 * nothing here saves a product. Each suggestion is logged (who, which
 * product, what kind, which model), never its text.
 */
export async function suggestProductText(
  connection: AiConnection,
  who: { accountId: string; storeId: string; productId: string | null },
  request: WriteRequest,
): Promise<{ written: WrittenText; model: string }> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const reply = await completeText(connection, writingMessages(request), {
    // Room for a reasoning model's thinking as well as a long description.
    maxTokens: 4000,
    timeoutMs: 60_000,
    reasoningEffort: "low",
  });
  const written = cleanWritten(parseModelJson(reply.text), request.kind, request.facts);
  if (!written) throw new AiError("The model did not answer with the texts asked for.");
  await audit(who.accountId, who.storeId, "product.ai_suggested", {
    productId: who.productId,
    kind: request.kind,
    language: request.language,
    model: connection.textModel,
    source: connection.source,
  });
  return { written, model: connection.textModel };
}
