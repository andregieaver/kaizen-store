import "server-only";

import { findAvoided } from "@/lib/brand";
import { parseModelJson } from "@/lib/query-understanding";
import { cleanWritten, writingMessages, type WriteRequest, type WrittenText } from "@/lib/product-writing";

import { AiError, completeText, type AiConnection } from "./ai";
import { audit } from "./auth";
import { brandOf } from "./brand";

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
): Promise<{ written: WrittenText; model: string; avoid: string[] }> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  // The brand guides new words (D330 F2b); its words to avoid are asked away once, and staff see any still there.
  const brand = await brandOf(who.storeId);
  const avoid = request.kind === "translate" ? [] : brand.avoid;
  const messages = writingMessages(request, brand);
  const options = {
    // Room for a reasoning model's thinking as well as a long description.
    maxTokens: 4000,
    timeoutMs: 60_000,
    reasoningEffort: "low",
  } as const;
  let reply = await completeText(connection, messages, options);
  let written = cleanWritten(parseModelJson(reply.text), request.kind, request.facts);
  const avoided = written ? avoidedIn(written, avoid) : [];
  if (written && avoided.length > 0) {
    reply = await completeText(
      connection,
      [
        ...messages,
        { role: "assistant", content: reply.text.slice(0, 12_000) },
        { role: "user", content: `The brand never uses ${avoided.map((w) => JSON.stringify(w)).join(", ")}. Write it again without them, as the same JSON.` },
      ],
      options,
    );
    written = cleanWritten(parseModelJson(reply.text), request.kind, request.facts) ?? written;
  }
  if (!written) throw new AiError("The model did not answer with the texts asked for.");
  await audit(who.accountId, who.storeId, "product.ai_suggested", {
    productId: who.productId,
    kind: request.kind,
    language: request.language,
    model: connection.textModel,
    source: connection.source,
  });
  return { written, model: connection.textModel, avoid };
}

/** The brand's words to avoid that a suggestion uses, once each. */
function avoidedIn(written: WrittenText, avoid: readonly string[]): string[] {
  const found = Object.values(written).flatMap((text) => (text ? findAvoided(text, avoid).map((f) => f.phrase.toLowerCase()) : []));
  return [...new Set(found)];
}
