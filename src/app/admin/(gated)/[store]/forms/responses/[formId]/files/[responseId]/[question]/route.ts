import { z } from "zod";

import { QUESTION_KEY, fileDownload } from "@/lib/form-file-download";
import { fileForStaff } from "@/server/form-files";
import { checkPermission } from "@/server/permissions";

/** A file sent with a store's form (D738 F6b), for members who may read customers (it is a person's), as a download only. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/forms/responses/[formId]/files/[responseId]/[question]">): Promise<Response> {
  const { store: slug, formId, responseId, question } = await params;
  const member = await checkPermission(slug, "customers:read");
  if (!member || !z.uuid().safeParse(formId).success || !z.uuid().safeParse(responseId).success || !QUESTION_KEY.test(question)) {
    return new Response("Not found", { status: 404 });
  }
  const file = await fileForStaff(member.store.id, formId, responseId, question);
  return file ? fileDownload(file) : new Response("Not found", { status: 404 });
}
