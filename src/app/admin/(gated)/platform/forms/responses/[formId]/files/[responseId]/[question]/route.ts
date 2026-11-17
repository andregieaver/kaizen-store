import { z } from "zod";

import { QUESTION_KEY, fileDownload } from "@/lib/form-file-download";
import { getAccount, platformCan } from "@/server/auth";
import { fileForStaff } from "@/server/form-files";

/** A file sent with one of Kaizena Flow's forms (D738 F6b), for the platform's team who may read its website, as a download only. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/platform/forms/responses/[formId]/files/[responseId]/[question]">): Promise<Response> {
  const { formId, responseId, question } = await params;
  const account = await getAccount();
  if (!account || !platformCan(account, "website", "read")) return new Response("Not found", { status: 404 });
  if (!z.uuid().safeParse(formId).success || !z.uuid().safeParse(responseId).success || !QUESTION_KEY.test(question)) return new Response("Not found", { status: 404 });
  const file = await fileForStaff(null, formId, responseId, question);
  return file ? fileDownload(file) : new Response("Not found", { status: 404 });
}
