"use server";

import { redirect } from "next/navigation";

import { marketPath } from "@/lib/paths";
import { unsubscribe } from "@/server/cart-reminders";

/** The button on the unsubscribe page: no more cart reminders to this email from the store (D33). */
export async function unsubscribeAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const done = token.length <= 64 ? await unsubscribe(token) : null;
  redirect(`${marketPath(storeSlug, marketSlug, `/unsubscribe/${token}`)}?${done ? "done" : "unknown"}=1`);
}
