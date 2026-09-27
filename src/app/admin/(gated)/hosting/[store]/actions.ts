"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import type { PaymentModeName } from "@/lib/stripe-account";
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
import { saveHostTaxDetails, saveUnitProperty } from "@/server/dac7";
import { createHostAccountSession, createHostStripeAccount, refreshHostStripeAccount } from "@/server/host-payments";
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

// ---------------------------------------------------------------------------
// The host's own Stripe account (D71)
// ---------------------------------------------------------------------------

const mode = z.enum(["test", "live"]);

export async function hostCreateStripeAccountAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const hosting = await requireHost(storeSlug);
  const parsed = mode.safeParse(formData.get("mode"));
  if (!parsed.success) return { status: "error", messages: ["Unknown mode."] };
  const result = await createHostStripeAccount(hosting, parsed.data);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  refresh();
  return { status: "ok", messages: ["Account created."] };
}

export async function hostAccountSessionAction(
  storeSlug: string,
  modeName: PaymentModeName,
): Promise<{ ok: true; clientSecret: string } | { ok: false; problem: string }> {
  const { store, host } = await requireHost(storeSlug);
  const parsed = mode.safeParse(modeName);
  if (!parsed.success) return { ok: false, problem: "Unknown mode." };
  return createHostAccountSession(store.id, host.id, parsed.data);
}

export async function hostRefreshStripeAccountAction(storeSlug: string, modeName: PaymentModeName): Promise<void> {
  const { store, host } = await requireHost(storeSlug);
  const parsed = mode.safeParse(modeName);
  if (parsed.success) await refreshHostStripeAccount(store.id, host.id, parsed.data);
  refresh();
}

// ---------------------------------------------------------------------------
// DAC7 details (D71)
// ---------------------------------------------------------------------------

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

export async function hostSaveTaxDetailsAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const hosting = await requireHost(storeSlug);
  const result = await saveHostTaxDetails(hosting, {
    kind: formData.get("kind"),
    legalName: text(formData, "legalName"),
    dateOfBirth: text(formData, "dateOfBirth"),
    address: text(formData, "address"),
    country: text(formData, "country"),
    tin: text(formData, "tin"),
    tinCountry: text(formData, "tinCountry"),
    vatNumber: text(formData, "vatNumber"),
    businessNumber: text(formData, "businessNumber"),
    iban: text(formData, "iban"),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved. Thank you."] };
}

export async function hostSavePropertyAction(storeSlug: string, resourceId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const hosting = await owned(storeSlug, resourceId);
  if (!hosting) return gone;
  const result = await saveUnitProperty(hosting, resourceId, {
    address: text(formData, "address"),
    landRegistryNumber: text(formData, "landRegistryNumber"),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved."] };
}
