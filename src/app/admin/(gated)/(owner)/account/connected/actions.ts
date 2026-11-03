"use server";

import { refresh } from "next/cache";

import { requireAccount } from "@/server/auth";
import { disconnectGrant } from "@/server/oauth";

/** *Disconnect* on Connected apps and assistants (D439): the person's own grant ends at once, with every token of it. */
export async function disconnectGrantAction(grantId: string): Promise<void> {
  const account = await requireAccount();
  await disconnectGrant(account, grantId);
  refresh();
}
