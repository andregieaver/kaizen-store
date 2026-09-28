"use server";

import type { PageBrief, PagePlan, PictureJob, StudioMessage } from "@/lib/page-ai";
import { requirePlatformAdmin } from "@/server/auth";
import { buildDraft, fillPicture, hearOwner, interviewTurn, planPage, speakToOwner, type StudioOwner } from "@/server/page-ai";
import { isPageId, readRecording, readStudioInput, readStudioPlan, unreadable } from "@/server/page-studio-input";

/** Kaizen's AI page studio (D92), for platform admins; pages are saved as drafts only. */

async function studioOwner(): Promise<StudioOwner> {
  const account = await requirePlatformAdmin();
  return { storeId: null, storeSlug: null, account };
}

export async function platformStudioTalkAction(history: StudioMessage[], brief: PageBrief) {
  const owner = await studioOwner();
  const input = readStudioInput(history, brief);
  return input ? interviewTurn(owner, input.history, input.brief) : unreadable;
}

export async function platformStudioPlanAction(history: StudioMessage[], brief: PageBrief, change: { plan: PagePlan; request: string } | null) {
  const owner = await studioOwner();
  const input = readStudioInput(history, brief);
  if (!input) return unreadable;
  if (!change) return planPage(owner, input.history, input.brief);
  const plan = readStudioPlan(change.plan);
  const request = typeof change.request === "string" ? change.request.trim().slice(0, 4000) : "";
  return plan && request ? planPage(owner, input.history, input.brief, { plan, request }) : unreadable;
}

export async function platformStudioBuildAction(history: StudioMessage[], brief: PageBrief, plan: PagePlan) {
  const owner = await studioOwner();
  const input = readStudioInput(history, brief);
  const checked = readStudioPlan(plan);
  return input && checked ? buildDraft(owner, input.history, input.brief, checked) : unreadable;
}

export async function platformStudioPictureAction(pageId: string, job: PictureJob) {
  const owner = await studioOwner();
  return isPageId(pageId) ? fillPicture(owner, pageId, job) : unreadable;
}

export async function platformStudioHearAction(form: FormData) {
  await studioOwner();
  const audio = readRecording(form);
  return audio ? hearOwner(null, audio) : unreadable;
}

export async function platformStudioSpeakAction(text: string) {
  await studioOwner();
  return typeof text === "string" && text.trim() ? speakToOwner(null, text) : unreadable;
}
