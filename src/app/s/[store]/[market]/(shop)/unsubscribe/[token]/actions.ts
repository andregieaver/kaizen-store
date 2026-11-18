"use server";

import { redirect } from "next/navigation";

import { marketPath } from "@/lib/paths";
import { unsubscribe } from "@/server/cart-reminders";
import { unsubscribeByToken } from "@/server/marketing-subscribers";

/** The button on the unsubscribe page: no more marketing email (D295) or cart reminders (D33) to this email from the store. */
export async function unsubscribeAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const done = token.length <= 64 ? ((await unsubscribeByToken(token, "link")) ?? (await unsubscribe(token))) : null;
  redirect(`${marketPath(storeSlug, marketSlug, `/unsubscribe/${token}`)}?${done ? "done" : "unknown"}=1`);
}
