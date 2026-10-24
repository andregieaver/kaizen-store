"use server";

import { updateTag } from "next/cache";

import { reviewsTag } from "@/lib/reviews";
import { checkPermission } from "@/server/permissions";
import { importReviews } from "@/server/review-import";
import type { ImportState } from "@/lib/review-import";

/** Checks a file of reviews and, unless only checking, imports what it can (D301 G3b): `products:write`, the file read in this request and kept nowhere. */
export async function importReviewsAction(storeSlug: string, _state: ImportState, form: FormData): Promise<ImportState> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problem: "forbidden" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, problem: "noFile" };
  const outcome = await importReviews(member.store.id, member.account.id, new Uint8Array(await file.arrayBuffer()), {
    from: String(form.get("from") ?? ""),
    publish: form.get("publish") === "now",
    check: form.get("check") === "on",
  });
  if (outcome.ok && !outcome.checked && outcome.imported > 0 && outcome.published) updateTag(reviewsTag(member.store.id));
  return outcome;
}
