"use server";

import { redirect } from "next/navigation";

import { stopByToken } from "@/server/sms";

/** The stop link's button (D565): that number gets no more marketing texts from the store. Back to the page, which says so; works without a script. */
export async function stopSmsAction(token: string) {
  await stopByToken(token);
  redirect(`/sms/${encodeURIComponent(token)}`);
}
