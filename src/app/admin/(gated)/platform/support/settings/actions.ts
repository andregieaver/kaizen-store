"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { EMBEDS_MAX } from "@/lib/support-embed";
import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { chatTag } from "@/server/chat-agent";
import { checkKaizenDesk } from "@/server/support-desk";
import { saveDeskSettings } from "@/server/support-settings";
import { platformAction } from "@/server/store-action";
import { addEmbed, checkEmbed, removeEmbed } from "@/server/support-embeds";

/** Kaizen's own support settings (D216, 2.10): platform admins, each as an owner of Kaizen's desk. */
export async function saveKaizenSupportSettingsAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const staff = await checkKaizenDesk();
  if (!staff) return { status: "error", messages: [w.noAccess] };
  const result = await saveDeskSettings(staff, Object.fromEntries(formData), {
    owner: true,
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(chatTag(null));
  refresh();
  return {
    status: "ok",
    messages: [
      result.ended > 0 ? countWords(result.ended, w.savedEnded) : w.saved,
    ],
  };
}

// The chat on Kaizena Flow's own other websites (D581) ------------------------------------------------------------------------------

const embedAnswer = (message: string): FormState => ({ status: "error", messages: [message] });

/** Adds a website that shows Kaizena Flow's chat (the support area, D510); its tag is checked at once. */
export async function addKaizenEmbedAction(_state: FormState, formData: FormData): Promise<FormState> {
  return platformAction({ area: "support", action: "support.embed_add", answer: embedAnswer }, async (_account, lang) => {
    const w = adminText(lang, "support").embed;
    const staff = await checkKaizenDesk();
    if (!staff) return embedAnswer(w.problems.noAccess);
    const result = await addEmbed(staff, { host: String(formData.get("host") ?? ""), privacy: String(formData.get("privacy") ?? "") }, null);
    if (!result.ok) return embedAnswer(result.problem === "max" ? fillWords(w.problems.max, { n: String(EMBEDS_MAX) }) : w.problems[result.problem]);
    refresh();
    return { status: "ok", messages: [result.embed.verifiedAt ? w.addedLive : w.added] };
  });
}

/** Checks a website's tag now. */
export async function checkKaizenEmbedAction(_state: FormState, formData: FormData): Promise<FormState> {
  return platformAction({ area: "support", action: "support.embed_check", answer: embedAnswer }, async (_account, lang) => {
    const w = adminText(lang, "support").embed;
    const staff = await checkKaizenDesk();
    const embed = staff ? await checkEmbed(staff.desk, String(formData.get("id") ?? "")) : null;
    if (!embed) return embedAnswer(adminText(lang, "support").problems.cannot);
    refresh();
    return embed.verifiedAt ? { status: "ok", messages: [w.checkedLive] } : embedAnswer(embed.checkProblem ? fillWords(w.checkProblem[embed.checkProblem], { host: embed.host }) : w.checkedNot);
  });
}

/** Removes a website: its tag stops showing the chat. */
export async function removeKaizenEmbedAction(_state: FormState, formData: FormData): Promise<FormState> {
  return platformAction({ area: "support", action: "support.embed_remove", answer: embedAnswer }, async (_account, lang) => {
    const staff = await checkKaizenDesk();
    const removed = staff ? await removeEmbed(staff, String(formData.get("id") ?? "")) : false;
    if (!removed) return embedAnswer(adminText(lang, "support").problems.cannot);
    refresh();
    return { status: "ok", messages: [adminText(lang, "support").embed.removed] };
  });
}
