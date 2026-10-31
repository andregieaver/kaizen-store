"use server";

import type { FormState } from "@/components/admin/action-form";
import { reportInput } from "@/lib/content-reports";
import { formProblems } from "@/lib/form-problems";
import { langOfLocale, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { log } from "@/server/log";
import { submitContentReport } from "@/server/content-reports";

/** The language the form was sent in: its `locale` field, English for anything else. */
const langOfForm = (formData: FormData): PlatformLang => langOfLocale(String(formData.get("locale") ?? "")) ?? "en";

/** A notice of illegal content (DSA art. 16, D411): checked, kept, and answered with a receipt by email. */
export async function sendContentReport(_state: FormState, formData: FormData): Promise<FormState> {
  const lang = langOfForm(formData);
  const w = platformText(lang).report;
  // A field people never see; bots fill it in. They get the same answer and nothing is kept.
  if (String(formData.get("website") ?? "") !== "") return { status: "ok", messages: [w.received] };
  const parsed = reportInput(w.problems).safeParse({
    url: String(formData.get("url") ?? ""),
    category: String(formData.get("category") ?? ""),
    explanation: String(formData.get("explanation") ?? ""),
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    goodFaith: formData.get("goodFaith") === "on",
  });
  if (!parsed.success) return formProblems(parsed.error.issues);
  try {
    await submitContentReport(parsed.data, lang);
  } catch (error) {
    log("error", "content_report.failed", {}, error);
    return { status: "error", messages: [w.failed] };
  }
  return { status: "ok", messages: [w.received] };
}
