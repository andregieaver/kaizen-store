import "server-only";

import { billPrompt, parseBillReading, type BillReading } from "@/lib/bill-reading";
import { READABLE_RECEIPTS, voucherTypeOf } from "@/lib/purchases";

import { aiFor, completeText, imagePart, seeing, type AiConnection, type ContentPart } from "./ai";
import { log } from "./log";

/**
 * A supplier's invoice read by the store's model into the bill form (B3, D493): a PDF's text (its first pages, read by `unpdf`) sent to the
 * text model, a photo to the model that sees pictures (`seeing()`), with the prompt `billPrompt()` writes; the answer read by
 * `parseBillReading()`. Null when the store has no AI, the file is neither a PDF with text nor a picture the model takes (a scanned PDF, a
 * HEIC photo), or the answer is not of the shape: the owner fills the form, as without it. Metered as `receipt_reading`.
 */
export async function readBill(
  storeId: string,
  accountId: string,
  bytes: Uint8Array,
  bookCurrency: string,
  deps: { connection?: AiConnection | null } = {},
): Promise<{ ok: true; reading: BillReading } | { ok: false; reason: "no_ai" | "not_readable" | "unread" }> {
  const type = voucherTypeOf(bytes);
  if (!type) return { ok: false, reason: "not_readable" };
  let pdfText: string | null = null;
  if (type.contentType === "application/pdf") {
    pdfText = await pdfTextOf(bytes);
    if (!pdfText) return { ok: false, reason: "not_readable" };
  } else if (!(READABLE_RECEIPTS as readonly string[]).includes(type.contentType)) return { ok: false, reason: "not_readable" };
  const ai = deps.connection === undefined ? await aiFor(storeId, { feature: "receipt_reading", accountId }) : deps.connection;
  const connection = pdfText === null ? seeing(ai) : ai;
  if (!connection) return { ok: false, reason: "no_ai" };
  const prompt = billPrompt(bookCurrency, pdfText);
  const content: string | ContentPart[] = pdfText === null ? [{ type: "text", text: prompt.user }, imagePart(connection, bytes, type.contentType)] : prompt.user;
  try {
    const { text } = await completeText(
      connection,
      [
        { role: "system", content: prompt.system },
        { role: "user", content },
      ],
      { maxTokens: 600, timeoutMs: 45_000, temperature: 0 },
    );
    const reading = parseBillReading(text);
    return reading ? { ok: true, reading } : { ok: false, reason: "unread" };
  } catch (error) {
    log("warn", "bill.read_failed", { storeId }, error);
    return { ok: false, reason: "unread" };
  }
}

/** The text of a PDF's first three pages, or null when it has none (a scan) or cannot be read. */
async function pdfTextOf(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).slice(0, 3).join("\n").trim();
    return pages.length >= 20 ? pages : null;
  } catch {
    return null;
  }
}
