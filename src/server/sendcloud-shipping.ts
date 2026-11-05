import "server-only";

import type { SendcloudSender } from "@/lib/sendcloud";

import { readSenders } from "./carriers/sendcloud";
import { carrierContext } from "./shipping-carriers";

/**
 * What the Sendcloud page offers as sender addresses (D454 step 1): the shop's own addresses, read from its Sendcloud account with
 * its saved keys when the page is drawn, so the owner chooses one rather than typing an id. Null before the keys are saved; the
 * sentence to show when Sendcloud does not answer or refuses. The page never sees the keys.
 */
export async function sendcloudSenders(storeId: string): Promise<{ ok: true; senders: SendcloudSender[] } | { ok: false; problem: string } | null> {
  const context = await carrierContext(storeId, "sendcloud");
  if (!context) return null;
  return readSenders(context);
}
