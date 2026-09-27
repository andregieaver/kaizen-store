"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { cancelBooking, removeResource, saveResource, type ResourceKind } from "@/server/bookings";
import { addBlock, addFeed, removeBlock, removeFeed, resetCalendarToken, syncFeed } from "@/server/calendar-sync";
import { markNoShow } from "@/server/no-show";
import { sendBookingCancelled } from "@/server/shopper-emails";

/** Adds or changes a member of staff who takes appointments (D65); a new one goes back to the list. */
export async function saveStaffAction(
  storeSlug: string,
  staffId: string | null,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (staffId && !z.uuid().safeParse(staffId).success) return { status: "error", messages: ["They are no longer in the store."] };
  const result = await saveResource(member, staffId, {
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    capacity: formData.get("capacity"),
    active: formData.get("active") === "on",
    hours: formData.get("hours"),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  if (!staffId) redirect(`/admin/${storeSlug}/bookings/staff`);
  return { status: "ok", messages: ["Saved."] };
}

export async function removeStaffAction(storeSlug: string, staffId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(staffId).success || !(await removeResource(member, staffId))) {
    return { ok: false, problems: ["They are no longer in the store."] };
  }
  redirect(`/admin/${storeSlug}/bookings/staff`);
}

/** Adds or changes a room or home (a unit) or a rental item (D67); a new one goes back to the list. */
export async function saveUnitAction(
  storeSlug: string,
  kind: Exclude<ResourceKind, "staff">,
  unitId: string | null,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const gone = "It is no longer in the store.";
  if (unitId && !z.uuid().safeParse(unitId).success) return { status: "error", messages: [gone] };
  const result = await saveResource(
    member,
    unitId,
    {
      name: formData.get("name"),
      email: "",
      capacity: formData.get("capacity"),
      active: formData.get("active") === "on",
      hostId: formData.get("hostId") || null,
    },
    kind,
  );
  const words: Record<string, string> = { "They are no longer in the store.": gone, "Give them a name.": "Give it a name." };
  if (!result.ok) return { status: "error", messages: result.problems.map((p) => words[p] ?? p) };
  if (!unitId) redirect(`/admin/${storeSlug}/bookings/units`);
  return { status: "ok", messages: ["Saved."] };
}

export async function removeUnitAction(storeSlug: string, unitId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(unitId).success || !(await removeResource(member, unitId))) {
    return { ok: false, problems: ["It is no longer in the store."] };
  }
  redirect(`/admin/${storeSlug}/bookings/units`);
}

/**
 * Cancels one confirmed appointment from the calendar (D65), telling the
 * shopper with a calendar cancellation when asked. Paying back is done from
 * the order.
 */
export async function cancelBookingAction(storeSlug: string, bookingId: string, formData: FormData): Promise<void> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(bookingId).success) return;
  if (!(await cancelBooking(member, bookingId))) return;
  if (formData.get("notify") === "on") await sendBookingCancelled(member.store.id, bookingId);
  refresh();
}

export type NoShowState = { ok: boolean; message: string | null };

/** Marks a booking as a no-show (D66), charging its fee to the saved card when asked. */
export async function noShowAction(
  storeSlug: string,
  bookingId: string,
  _previous: NoShowState,
  formData: FormData,
): Promise<NoShowState> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(bookingId).success) return { ok: false, message: "This booking no longer exists." };
  const result = await markNoShow(member, bookingId, formData.get("charge") === "on");
  if (!result.ok) return { ok: false, message: result.problem };
  refresh();
  return { ok: true, message: result.chargedMinor > 0 ? "Marked as a no-show, and the fee is charged." : "Marked as a no-show." };
}

// ---------------------------------------------------------------------------
// Blocked dates and calendar sync (D67, B3b)
// ---------------------------------------------------------------------------

const id = z.uuid();

/** Closes a room, item or member of staff for some dates, saying if bookings are already there. */
export async function addBlockAction(storeSlug: string, resourceId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (!id.safeParse(resourceId).success) return { status: "error", messages: ["It is no longer in the store."] };
  const result = await addBlock(member, resourceId, {
    from: formData.get("from"),
    to: formData.get("to"),
    note: formData.get("note") ?? "",
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return {
    status: "ok",
    messages: [
      result.clashes === 0
        ? "Blocked."
        : `Blocked. ${result.clashes === 1 ? "1 booking is" : `${result.clashes} bookings are`} already there; they stay until you cancel them.`,
    ],
  };
}

export async function removeBlockAction(storeSlug: string, blockId: string): Promise<void> {
  const member = await requireMember(storeSlug);
  if (id.safeParse(blockId).success) await removeBlock(member, blockId);
  refresh();
}

/** Makes (or replaces) the secret address other sites read the resource's calendar from. */
export async function resetCalendarAction(storeSlug: string, resourceId: string): Promise<void> {
  const member = await requireMember(storeSlug);
  if (id.safeParse(resourceId).success) await resetCalendarToken(member, resourceId);
  refresh();
}

/** Adds a calendar from another site and reads it at once. */
export async function addFeedAction(storeSlug: string, resourceId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (!id.safeParse(resourceId).success) return { status: "error", messages: ["It is no longer in the store."] };
  const result = await addFeed(member, resourceId, { name: formData.get("name"), url: formData.get("url") });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return result.sync.ok
    ? { status: "ok", messages: [`Added, and read ${result.sync.events === 1 ? "1 event" : `${result.sync.events} events`}.`] }
    : { status: "error", messages: [`Added, but it could not be read: ${result.sync.error} It is tried again every 15 minutes.`] };
}

export async function syncFeedAction(storeSlug: string, feedId: string): Promise<void> {
  const member = await requireMember(storeSlug);
  if (id.safeParse(feedId).success) await syncFeed(member.store.id, feedId);
  refresh();
}

export async function removeFeedAction(storeSlug: string, feedId: string): Promise<void> {
  const member = await requireMember(storeSlug);
  if (id.safeParse(feedId).success) await removeFeed(member, feedId);
  refresh();
}
