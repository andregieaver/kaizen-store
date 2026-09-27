"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import {
  addBlock,
  addFeed,
  removeBlock,
  removeFeed,
  resetCalendarToken,
  resourceOfBlock,
  resourceOfFeed,
  syncFeed,
} from "@/server/calendar-sync";
import { hostOwnsResource, requireHost, type Hosting } from "@/server/hosts";

/**
 * A host keeps the calendars of their own rooms and items (D71): every
 * action checks the resource (or the block or feed's resource) is theirs.
 */
const id = z.uuid();
const gone: FormState = { status: "error", messages: ["That is not one of your rooms or items."] };

async function owned(storeSlug: string, resourceId: string | null): Promise<Hosting | null> {
  const hosting = await requireHost(storeSlug);
  if (!resourceId || !id.safeParse(resourceId).success) return null;
  return (await hostOwnsResource(hosting.store.id, hosting.host.id, resourceId)) ? hosting : null;
}

export async function hostAddBlockAction(storeSlug: string, resourceId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const hosting = await owned(storeSlug, resourceId);
  if (!hosting) return gone;
  const result = await addBlock(hosting, resourceId, { from: formData.get("from"), to: formData.get("to"), note: formData.get("note") ?? "" });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return {
    status: "ok",
    messages: [result.clashes === 0 ? "Blocked." : `Blocked. ${result.clashes} booking(s) are already there; ask the store to sort them out.`],
  };
}

export async function hostRemoveBlockAction(storeSlug: string, blockId: string): Promise<void> {
  const hosting = await requireHost(storeSlug);
  if (!id.safeParse(blockId).success) return;
  if (await owned(storeSlug, await resourceOfBlock(hosting.store.id, blockId))) await removeBlock(hosting, blockId);
  refresh();
}

export async function hostResetCalendarAction(storeSlug: string, resourceId: string): Promise<void> {
  const hosting = await owned(storeSlug, resourceId);
  if (hosting) await resetCalendarToken(hosting, resourceId);
  refresh();
}

export async function hostAddFeedAction(storeSlug: string, resourceId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const hosting = await owned(storeSlug, resourceId);
  if (!hosting) return gone;
  const result = await addFeed(hosting, resourceId, { name: formData.get("name"), url: formData.get("url") });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return result.sync.ok
    ? { status: "ok", messages: [`Added, and read ${result.sync.events === 1 ? "1 event" : `${result.sync.events} events`}.`] }
    : { status: "error", messages: [`Added, but it could not be read: ${result.sync.error} It is tried again every 15 minutes.`] };
}

export async function hostSyncFeedAction(storeSlug: string, feedId: string): Promise<void> {
  const hosting = await requireHost(storeSlug);
  if (!id.safeParse(feedId).success) return;
  if (await owned(storeSlug, await resourceOfFeed(hosting.store.id, feedId))) await syncFeed(hosting.store.id, feedId);
  refresh();
}

export async function hostRemoveFeedAction(storeSlug: string, feedId: string): Promise<void> {
  const hosting = await requireHost(storeSlug);
  if (!id.safeParse(feedId).success) return;
  if (await owned(storeSlug, await resourceOfFeed(hosting.store.id, feedId))) await removeFeed(hosting, feedId);
  refresh();
}
