"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { addIdea, decideIncident, saveAutopilotSettings, type OwnerDecision } from "@/server/incidents";
import { platformAction } from "@/server/store-action";

const DECISIONS: readonly OwnerDecision[] = ["approve", "dismiss", "send_back", "wont_fix", "reopen"];

/**
 * Everything the incidents page asks (D895), by the button pressed (`intent`): a decision on an entry, an idea, or the autopilot's settings.
 * One action, so the page adds one entry to the client manifest. The settings area's (an owner of the platform, D510), through
 * `platformAction()`.
 */
export async function incidentAction(_state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "settings", action: "platform.incidents", answer: (message): FormState => ({ status: "error", messages: [message] }) }, (admin, lang) =>
    act(admin.id, PLATFORM_WORDS[lang].incidents, form),
  );
}

async function act(accountId: string, w: (typeof PLATFORM_WORDS)["en"]["incidents"], form: FormData): Promise<FormState> {
  const intent = String(form.get("intent") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;
  if (intent === "idea") {
    const idea = await addIdea(accountId, String(form.get("title") ?? ""), note);
    if (!idea) return { status: "error", messages: [w.problems.idea] };
    refresh();
    return { status: "ok", messages: [w.idea.saved] };
  }
  if (intent === "settings") {
    const saved = await saveAutopilotSettings(accountId, { on: form.get("on") === "on", gapHours: Number(form.get("gap")) });
    if (!saved) return { status: "error", messages: [w.problems.gap] };
    refresh();
    return { status: "ok", messages: [w.autopilot.saved] };
  }
  const decision = DECISIONS.find((d) => d === intent);
  if (!decision) return { status: "error", messages: [w.problems.unknown] };
  const done = await decideIncident(accountId, String(form.get("id") ?? ""), decision, note);
  if (!done.ok) return { status: "error", messages: [w.problems[done.problem]] };
  refresh();
  return { status: "ok", messages: [w.moved] };
}
