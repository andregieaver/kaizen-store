import "server-only";

import { READABLE_RECEIPTS, parseReceiptReading, receiptPrompt, type ReceiptReading } from "@/lib/receipt-reading";
import { voucherTypeOf } from "@/lib/purchases";

import { aiFor, completeText, imagePart, seeing, type AiConnection } from "./ai";
import { log } from "./log";

/**
 * A receipt read by the store's model that sees pictures (B3 step 2, D491): the prompt `receiptPrompt()` writes, the picture sent as data
 * (never a link), the answer read by `parseReceiptReading()`. Null when the store has no AI that sees pictures, the file is no picture the
 * model takes (a PDF, a HEIC photo), or the model gives no answer of the shape: the owner then chooses, as without it. Metered as
 * `receipt_reading` for the store and the person who asked.
 */
export async function readReceipt(
  storeId: string,
  accountId: string,
  bytes: Uint8Array,
  bookCurrency: string,
  deps: { connection?: AiConnection | null } = {},
): Promise<{ ok: true; reading: ReceiptReading } | { ok: false; reason: "no_ai" | "not_a_picture" | "unread" }> {
  const type = voucherTypeOf(bytes);
  if (!type || !(READABLE_RECEIPTS as readonly string[]).includes(type.contentType)) return { ok: false, reason: "not_a_picture" };
  const connection = seeing(deps.connection === undefined ? await aiFor(storeId, { feature: "receipt_reading", accountId }) : deps.connection);
  if (!connection) return { ok: false, reason: "no_ai" };
  const prompt = receiptPrompt(bookCurrency);
  try {
    const { text } = await completeText(
      connection,
      [
        { role: "system", content: prompt.system },
        { role: "user", content: [{ type: "text", text: prompt.user }, imagePart(connection, bytes, type.contentType)] },
      ],
      { maxTokens: 500, timeoutMs: 45_000, temperature: 0 },
    );
    const reading = parseReceiptReading(text);
    return reading ? { ok: true, reading } : { ok: false, reason: "unread" };
  } catch (error) {
    log("warn", "receipt.read_failed", { storeId }, error);
    return { ok: false, reason: "unread" };
  }
}
