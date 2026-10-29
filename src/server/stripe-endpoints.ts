import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { PaymentModeName } from "@/lib/stripe-account";
import { siteUrl } from "@/lib/site";

import { log } from "./log";
import { connectWebhookUrl, platformStripe, type WebhookKind } from "./stripe";
import { col, typedRows } from "./typed-rows";

/** What moving one of Kaizena Flow's Stripe endpoints needs: the classic endpoints and the v2 event destination take their address apart. */
export type EndpointMover = {
  endpoint(id: string, url: string): Promise<void>;
  destination(id: string, url: string): Promise<void>;
};

function moverFor(mode: PaymentModeName): EndpointMover | null {
  const stripe = platformStripe(mode);
  if (!stripe) return null;
  return {
    endpoint: async (id, url) => void (await stripe.webhookEndpoints.update(id, { url })),
    destination: async (id, url) => void (await stripe.v2.core.eventDestinations.update(id, { webhook_endpoint: { url } })),
  };
}

const ROW = z.object({ mode: col.text, kind: col.text, endpoint_id: col.text, url: col.text });

/**
 * Keeps Kaizena Flow's Stripe endpoints at the site's own address (consolidation, 29 October 2026). They were made at the address the site had
 * when an admin connected them, and Stripe follows no redirect: after the move to kaizenaflow.com every event went to the old domain, which
 * answers 308, so none arrived (disputes, refunds made in Stripe, payouts, accounts' status, bank payments). Each endpoint whose address is not
 * the one `connectWebhookUrl()` gives for `siteUrl()` is moved at Stripe (its signing secret stays) and the row follows. A preview deployment
 * (a `vercel.app` or local address) moves nothing. Returns how many endpoints were moved.
 */
export async function keepStripeWebhooksCurrent(movers: (mode: PaymentModeName) => EndpointMover | null = moverFor): Promise<number> {
  const origin = siteUrl();
  if (!origin.startsWith("https://") || origin.endsWith(".vercel.app")) return 0;
  const rows = await typedRows(ROW, sql`select mode, kind, endpoint_id, url from commerce.platform_webhooks where provider = 'stripe' order by mode, kind`);
  let moved = 0;
  for (const row of rows) {
    const mode = row.mode as PaymentModeName;
    const kind = row.kind as WebhookKind;
    const wanted = connectWebhookUrl(origin, mode, kind);
    if (row.url === wanted) continue;
    const mover = movers(mode);
    if (!mover) continue;
    try {
      await (kind === "thin" ? mover.destination(row.endpoint_id, wanted) : mover.endpoint(row.endpoint_id, wanted));
      await db().execute(sql`
        update commerce.platform_webhooks set url = ${wanted}, updated_at = now()
        where provider = 'stripe' and mode = ${mode} and kind = ${kind} and endpoint_id = ${row.endpoint_id}
      `);
      log("info", "stripe.webhook_moved", { mode, kind });
      moved++;
    } catch (error) {
      log("error", "stripe.webhook_move_failed", { mode, kind }, error);
    }
  }
  return moved;
}
