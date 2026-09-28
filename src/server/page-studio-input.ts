import "server-only";

import { z } from "zod";

import { pageBrief, pagePlan, studioMessages, type PageBrief, type PagePlan, type StudioMessage } from "@/lib/page-ai";

/**
 * What the AI page studio's actions (D92) take from the browser, read
 * again on the server: the conversation, the brief, the plan, a page's id
 * and a recording. Anything that does not read is refused as a problem.
 */

export type StudioInput = { history: StudioMessage[]; brief: PageBrief };

export function readStudioInput(history: unknown, brief: unknown): StudioInput | null {
  const messages = studioMessages.safeParse(history);
  if (!messages.success) return null;
  return { history: messages.data, brief: pageBrief.parse(brief && typeof brief === "object" ? brief : {}) };
}

export function readStudioPlan(plan: unknown): PagePlan | null {
  const parsed = pagePlan.safeParse(plan);
  return parsed.success ? parsed.data : null;
}

export const isPageId = (id: unknown): id is string => z.uuid().safeParse(id).success;

/** A spoken message: at most this many bytes of audio (about a minute). */
const AUDIO_MAX = 4 * 1024 * 1024;

export function readRecording(form: FormData): Blob | null {
  const audio = form.get("audio");
  return audio instanceof Blob && audio.size > 0 && audio.size <= AUDIO_MAX ? audio : null;
}

export const unreadable = { ok: false as const, problem: "That could not be read. Reload the page and try again." };
