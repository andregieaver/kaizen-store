import { connection } from "next/server";

import { fail, sameSite } from "@/server/chat-route";
import { formVisitor } from "@/server/forms";
import { askProductQuestion, productQuestionRequest } from "@/server/product-questions";

/**
 * A shopper's question about a product (D431), from a product layout's question part on the store's own pages: to the store's support inbox
 * with the product attached, or emailed while the desk is off. The answer is a page form's (`FormResponse`).
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "Questions come from the store's own pages only.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 40_000) return fail(413, "That is too long.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "The question could not be read.");
  }
  const parsed = productQuestionRequest.safeParse(body);
  if (!parsed.success) return fail(400, "The question could not be read.");
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const { status, body: answer } = await askProductQuestion(parsed.data, formVisitor(address));
  return Response.json(answer, { status, headers: { "Cache-Control": "no-store" } });
}
