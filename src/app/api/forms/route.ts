import { connection } from "next/server";

import { FORM_FILE_QUESTIONS_MAX, FORM_FILES_BYTES } from "@/lib/form-files";
import { formRequest } from "@/lib/forms-schema";
import { fail } from "@/lib/route-fail";
import { sameSite } from "@/lib/same-site";
import { totalTooBig, type SentFile } from "@/server/form-files";
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
  // A form with a file question (D738 F6b) sends multipart: the request as `request`, each file as `file:{question}`.
  const files: Record<string, SentFile> = {};
  try {
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > FORM_FILES_BYTES + 100_000) return fail(413, "The files are too big.");
      const form = await request.formData();
      const text = form.get("request");
      if (typeof text !== "string" || text.length > 40_000) return fail(400, "The form could not be read.");
      body = JSON.parse(text);
      for (const [key, value] of form.entries()) {
        if (!key.startsWith("file:") || typeof value === "string") continue;
        if (Object.keys(files).length >= FORM_FILE_QUESTIONS_MAX) return fail(400, "The form could not be read.");
        files[key.slice(5)] = { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) };
      }
      if (totalTooBig(Object.values(files))) return fail(413, "The files are too big.");
    } else {
      const text = await request.text();
      if (text.length > 40_000) return fail(413, "That is too long.");
      body = JSON.parse(text);
    }
  } catch {
    return fail(400, "The form could not be read.");
  }
  const parsed = formRequest.safeParse(body);
  if (!parsed.success) return fail(400, "The form could not be read.");
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const { status, body: answer } = await submitForm(parsed.data, formVisitor(address), files);
  return Response.json(answer, { status, headers: { "Cache-Control": "no-store" } });
}
