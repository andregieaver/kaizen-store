"use server";

import { refresh } from "next/cache";

import { requirePlatformAdmin } from "@/server/auth";
import { setClientBlocked, setClientVerified } from "@/server/oauth-clients";

/** *Verify* (or take it back) on the platform's list of clients (D439): the consent screen then shows the client without *Not verified*. */
export async function verifyClientAction(clientId: string, verified: boolean): Promise<void> {
  const admin = await requirePlatformAdmin();
  await setClientVerified(admin, clientId, verified);
  refresh();
}

/** *Block* (or let in again) a client (D439): blocked, every grant it has ends and it can ask nobody. */
export async function blockClientAction(clientId: string, blocked: boolean): Promise<void> {
  const admin = await requirePlatformAdmin();
  await setClientBlocked(admin, clientId, blocked);
  refresh();
}
