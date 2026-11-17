"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { parseAudience, type Audience } from "@/lib/experiments";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { previewLink } from "@/server/ab-preview";
import { audit } from "@/server/auth";
import {
  addVariant,
  applyVariant,
  createExperiment,
  deleteDraft,
  discardExperiment,
  getExperiment,
  removeVariant,
  renameExperiment,
  saveLearning,
  scheduleExperiment,
  startExperiment,
  stopExperiment,
  unscheduleExperiment,
  updateDraft,
  type DraftChanges,
  type NewExperiment,
  type Outcome,
} from "@/server/experiment-admin";

/**
 * A store's A/B tests of pages (D148): each action is bound to the store's slug, checks the member (`requireMember`) and
 * hands the request to the server module, which says what is wrong in words. Everything the browser sends is checked again.
 */

const isId = (id: string) => z.uuid().safeParse(id).success;
const unknown: Outcome = { ok: false, problems: ["Unknown test."] };

const newExperiment = z.object({
  part: z.object({ kind: z.enum(["row", "column", "block"]), id: z.string().min(1).max(64) }).nullable().optional(),
  name: z.string().max(200),
  hypothesis: z.string().max(1000).optional(),
  pageId: z.uuid(),
  goal: z.string().max(40),
  goalBlock: z.string().max(80).nullable().optional(),
  goalPage: z.uuid().nullable().optional(),
  trafficShare: z.number().min(0.01).max(1).optional(),
  audience: z.unknown().optional(),
  minDays: z.number().int().min(1).max(90).optional(),
  minVisitors: z.number().int().min(0).max(1_000_000).optional(),
});

/** Makes a test as a draft, with a copy of the page as its first version. */
export async function createExperimentAction(storeSlug: string, input: unknown): Promise<Outcome<{ id: string }>> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const parsed = newExperiment.safeParse(input);
  if (!parsed.success) return { ok: false, problems: ["Fill in the name, the page and what the test should improve."] };
  const audience: Audience = parseAudience(parsed.data.audience ?? {});
  const request: NewExperiment = { ...parsed.data, audience };
  return createExperiment(member.account, member.store.id, request);
}

const draftChanges = z.object({
  name: z.string().max(200).optional(),
  hypothesis: z.string().max(1000).optional(),
  goal: z.string().max(40).optional(),
  goalBlock: z.string().max(80).nullable().optional(),
  goalPage: z.uuid().nullable().optional(),
  trafficShare: z.number().min(0.01).max(1).optional(),
  audience: z.unknown().optional(),
  minDays: z.number().int().min(1).max(90).optional(),
  minVisitors: z.number().int().min(0).max(1_000_000).optional(),
  shares: z.record(z.string().max(1), z.number().min(0).max(1)).optional(),
});

/** Changes a draft: what it measures, who is in it and how the visitors are shared. */
export async function updateDraftAction(storeSlug: string, id: string, input: unknown): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const parsed = draftChanges.safeParse(input);
  if (!parsed.success) return { ok: false, problems: ["Some of the settings could not be read."] };
  const { audience, goal, ...rest } = parsed.data;
  const changes: DraftChanges = { ...rest, ...(goal !== undefined && { goal }), ...(audience !== undefined && { audience: parseAudience(audience) }) };
  const result = await updateDraft(member.account, member.store.id, id, changes);
  if (result.ok) refresh();
  return result;
}

/** Changes a running or finished test's name, hypothesis or planned end: nothing the numbers rest on. */
export async function renameExperimentAction(storeSlug: string, id: string, input: { name?: string; hypothesis?: string; plannedEnd?: string }): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const end = input.plannedEnd ? new Date(input.plannedEnd) : undefined;
  if (end && Number.isNaN(end.getTime())) return { ok: false, problems: ["That is not a date."] };
  const result = await renameExperiment(member.account, member.store.id, id, { name: input.name, hypothesis: input.hypothesis, plannedEnd: end });
  if (result.ok) refresh();
  return result;
}

export async function addVariantAction(storeSlug: string, id: string): Promise<Outcome<{ key: string }>> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return { ok: false, problems: ["Unknown test."] };
  const result = await addVariant(member.account, member.store.id, id);
  if (result.ok) refresh();
  return result;
}

export async function removeVariantAction(storeSlug: string, id: string, key: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id) || !/^[b-d]$/.test(key)) return unknown;
  const result = await removeVariant(member.account, member.store.id, id, key);
  if (result.ok) refresh();
  return result;
}

export async function startExperimentAction(storeSlug: string, id: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const result = await startExperiment(member.account, member.store.id, id);
  if (result.ok) refresh();
  return result;
}

/** Lets a test that is ready start by itself at a time (an ISO instant; the browser works it out from the owner's own clock). */
export async function scheduleExperimentAction(storeSlug: string, id: string, at: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const result = await scheduleExperiment(member.account, member.store.id, id, new Date(at));
  if (result.ok) refresh();
  return result;
}

/** Takes a scheduled test back to a draft. */
export async function unscheduleExperimentAction(storeSlug: string, id: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const result = await unscheduleExperiment(member.account, member.store.id, id);
  if (result.ok) refresh();
  return result;
}

export async function stopExperimentAction(storeSlug: string, id: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const result = await stopExperiment(member.account, member.store.id, id, "person");
  if (result.ok) refresh();
  return result;
}

/** Makes a version the page: its content replaces the original's. */
export async function applyVariantAction(storeSlug: string, id: string, key: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id) || !/^[b-d]$/.test(key)) return unknown;
  const result = await applyVariant(member.account, member.store.id, id, key);
  if (result.ok) refresh();
  return result;
}

/** Keeps the original: the test is discarded. */
export async function discardExperimentAction(storeSlug: string, id: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const result = await discardExperiment(member.account, member.store.id, id);
  if (result.ok) refresh();
  return result;
}

/**
 * Decides a test from its page (D659): a version becomes the page, or `original` keeps it. A running test is stopped first, as the AI
 * manager's `apply_winner` does, so a clear winner is one press (and a yes) away instead of Stop, then Decide.
 */
export async function decideExperimentAction(storeSlug: string, id: string, choice: string, learning = ""): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id) || !/^(original|[b-d])$/.test(choice)) return unknown;
  const test = await getExperiment(member.store.id, id);
  if (!test) return unknown;
  if (test.status === "running") {
    const stopped = await stopExperiment(member.account, member.store.id, id, "person");
    if (!stopped.ok) return stopped;
  }
  const result = choice === "original" ? await discardExperiment(member.account, member.store.id, id) : await applyVariant(member.account, member.store.id, id, choice);
  // What it taught (D662), kept with the decision when the owner wrote a line.
  if (result.ok && typeof learning === "string" && learning.trim()) await saveLearning(member.account, member.store.id, id, learning.slice(0, 400));
  refresh();
  return result;
}

/** Keeps what a test taught, in the owner's words (D662). */
export async function saveLearningAction(storeSlug: string, id: string, learning: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id) || typeof learning !== "string") return unknown;
  const result = await saveLearning(member.account, member.store.id, id, learning.slice(0, 400));
  if (result.ok) refresh();
  return result;
}

export async function deleteDraftAction(storeSlug: string, id: string): Promise<Outcome> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id)) return unknown;
  const result = await deleteDraft(member.account, member.store.id, id);
  if (result.ok) refresh();
  return result;
}

/**
 * A link that shows one version of a running test on the live site to whoever opens it (D148 phase 20, `src/server/ab-preview.ts`): never counted,
 * never indexed, over when the test stops. Made for a member who may change the store's marketing, and audited (without the link).
 */
export async function previewLinkAction(storeSlug: string, id: string, version: string): Promise<Outcome<{ url: string }>> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isId(id) || !/^[b-d]$/.test(version)) return { ok: false, problems: ["Unknown test."] };
  const url = await previewLink(member.store, id, version);
  if (!url) return { ok: false, problems: ["A preview link is made while the test runs."] };
  await audit(member.account.id, member.store.id, "experiment.preview_link", { experiment: id, version });
  return { ok: true, url };
}
