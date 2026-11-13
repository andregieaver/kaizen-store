"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { EMBEDS_MAX } from "@/lib/support-embed";
import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { chatTag } from "@/server/chat-agent";
import { checkPermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { saveDeskSettings } from "@/server/support-settings";
import { storeAction } from "@/server/store-action";
import { addEmbed, checkEmbed, removeEmbed } from "@/server/support-embeds";

/**
 * The store's support settings (D216, 2.10): `support:write`; how long transcripts are kept is the owner's alone. The chat on the
 * store's pages follows the desk's mode, so its cache is refreshed.
 */
export async function saveSupportSettingsAction(
  slug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const member = await checkPermission(slug, "support:write");
  if (!member) return { status: "error", messages: [w.noAccess] };
  const owner = await checkPermission(slug, "owner");
  const result = await saveDeskSettings(
    memberDesk(member),
    Object.fromEntries(formData),
    { owner: owner !== null },
  );
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(chatTag(member.store.id));
  refresh();
  return {
    status: "ok",
    messages: [
      result.ended > 0 ? countWords(result.ended, w.savedEnded) : w.saved,
    ],
  };
}

// The chat on the owner's own websites (D581) ---------------------------------------------------------------------------------------

const embedAnswer = (message: string): FormState => ({ status: "error", messages: [message] });

/** Adds a website that shows the store's chat (`support:write`); its tag is checked at once. */
export async function addSupportEmbedAction(slug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return storeAction({ store: slug, key: "support:write", action: "support.embed_add", answer: embedAnswer }, async (member, lang) => {
    const w = adminText(lang, "support").embed;
    const result = await addEmbed(
      memberDesk(member),
      { host: String(formData.get("host") ?? ""), privacy: String(formData.get("privacy") ?? ""), market: formData.get("market") ? String(formData.get("market")) : null },
      member.store.markets.map((market) => market.slug),
    );
    if (!result.ok) return embedAnswer(result.problem === "max" ? fillWords(w.problems.max, { n: String(EMBEDS_MAX) }) : w.problems[result.problem]);
    refresh();
    return { status: "ok", messages: [result.embed.verifiedAt ? w.addedLive : w.added] };
  });
}

/** Checks a website's tag now (`support:write`). */
export async function checkSupportEmbedAction(slug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return storeAction({ store: slug, key: "support:write", action: "support.embed_check", answer: embedAnswer }, async (member, lang) => {
    const w = adminText(lang, "support").embed;
    const embed = await checkEmbed(memberDesk(member).desk, String(formData.get("id") ?? ""));
    if (!embed) return embedAnswer(adminText(lang, "support").problems.cannot);
    refresh();
    return embed.verifiedAt ? { status: "ok", messages: [w.checkedLive] } : embedAnswer(embed.checkProblem ? fillWords(w.checkProblem[embed.checkProblem], { host: embed.host }) : w.checkedNot);
  });
}

/** Removes a website: its tag stops showing the chat (`support:write`). */
export async function removeSupportEmbedAction(slug: string, _state: FormState, formData: FormData): Promise<FormState> {
  return storeAction({ store: slug, key: "support:write", action: "support.embed_remove", answer: embedAnswer }, async (member, lang) => {
    const removed = await removeEmbed(memberDesk(member), String(formData.get("id") ?? ""));
    if (!removed) return embedAnswer(adminText(lang, "support").problems.cannot);
    refresh();
    return { status: "ok", messages: [adminText(lang, "support").embed.removed] };
  });
}
