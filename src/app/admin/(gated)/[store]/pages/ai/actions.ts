"use server";

import type { PageBrief, PagePlan, PictureJob, StudioMessage } from "@/lib/page-ai";
import { requirePermission } from "@/server/permissions";
import { buildDraft, fillPicture, hearOwner, interviewTurn, planPage, speakToOwner, type StudioOwner } from "@/server/page-ai";
import { isPageId, readRecording, readStudioInput, readStudioPlan, unreadable } from "@/server/page-studio-input";

/**
 * A store's AI page studio (D92): each step bound to the store's slug, for
 * its members, as the page builder is. Pages are saved as drafts only.
 */

async function studioOwner(storeSlug: string): Promise<StudioOwner> {
  const { store, account } = await requirePermission(storeSlug, "website:write");
  return { storeId: store.id, storeSlug: store.slug, account };
}

export async function storeStudioTalkAction(storeSlug: string, history: StudioMessage[], brief: PageBrief) {
  const owner = await studioOwner(storeSlug);
  const input = readStudioInput(history, brief);
  return input ? interviewTurn(owner, input.history, input.brief) : unreadable;
}

export async function storeStudioPlanAction(
  storeSlug: string,
  history: StudioMessage[],
  brief: PageBrief,
  change: { plan: PagePlan; request: string } | null,
) {
  const owner = await studioOwner(storeSlug);
  const input = readStudioInput(history, brief);
  if (!input) return unreadable;
  if (!change) return planPage(owner, input.history, input.brief);
  const plan = readStudioPlan(change.plan);
  const request = typeof change.request === "string" ? change.request.trim().slice(0, 4000) : "";
  return plan && request ? planPage(owner, input.history, input.brief, { plan, request }) : unreadable;
}

export async function storeStudioBuildAction(storeSlug: string, history: StudioMessage[], brief: PageBrief, plan: PagePlan) {
  const owner = await studioOwner(storeSlug);
  const input = readStudioInput(history, brief);
  const checked = readStudioPlan(plan);
  return input && checked ? buildDraft(owner, input.history, input.brief, checked) : unreadable;
}

export async function storeStudioPictureAction(storeSlug: string, pageId: string, job: PictureJob) {
  const owner = await studioOwner(storeSlug);
  return isPageId(pageId) ? fillPicture(owner, pageId, job) : unreadable;
}

export async function storeStudioHearAction(storeSlug: string, form: FormData) {
  const owner = await studioOwner(storeSlug);
  const audio = readRecording(form);
  return audio ? hearOwner(owner.storeId, audio) : unreadable;
}

export async function storeStudioSpeakAction(storeSlug: string, text: string) {
  const owner = await studioOwner(storeSlug);
  return typeof text === "string" && text.trim() ? speakToOwner(owner.storeId, text) : unreadable;
}
