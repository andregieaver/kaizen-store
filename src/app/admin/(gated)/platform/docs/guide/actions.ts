"use server";

import { refresh } from "next/cache";

import { requirePlatform } from "@/server/auth";
import { saveDocsGuide } from "@/server/docs-guide-settings";

/** The docs guide's settings (D444), saved by a platform admin; the docs' panel reads them afresh (`DOCS_GUIDE_TAG`). */
export async function saveDocsGuideAction(json: string) {
  const account = await requirePlatform("website");
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false as const, problems: ["The guide could not be read. Reload the page and try again."] };
  }
  const result = await saveDocsGuide(account, raw);
  if (result.ok) refresh();
  return result;
}
