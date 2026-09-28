import { connection } from "next/server";

import { formRequest } from "@/lib/forms";
import { fail, sameSite } from "@/server/chat-route";
import { formVisitor, submitForm } from "@/server/forms";

/**
 * A visitor sending one of a page's forms (D93): an email form's answers or
 * a newsletter sign-up, from the site's own pages only. The form is looked
 * up in its owner's published pages; the answer says it was sent, that an
 * email is on its way to confirm, or what to correct.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "Forms take answers from their own site only.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 40_000) return fail(413, "That is too long.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "The form could not be read.");
  }
  const parsed = formRequest.safeParse(body);
  if (!parsed.success) return fail(400, "The form could not be read.");
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const { status, body: answer } = await submitForm(parsed.data, formVisitor(address));
  return Response.json(answer, { status, headers: { "Cache-Control": "no-store" } });
}
