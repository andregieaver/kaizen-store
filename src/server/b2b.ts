import "server-only";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";

import { db } from "@/db/client";
import { BUYER_DAYS, buyerCookie, parseBuyer, STORE_AUDIENCES, storeBuyer, type Buyer } from "@/lib/b2b";

import { audit, type Membership } from "./auth";
import type { Store } from "./stores";

export const audienceInput = z.object({
  audience: z.enum(STORE_AUDIENCES, { error: "Choose who the store sells to." }),
  businessPopup: z.boolean(),
});

/** Who the store sells to (B2B), and whether first-time visitors are asked which they are. */
export async function saveStoreAudience({ account, store }: Membership, input: z.infer<typeof audienceInput>): Promise<void> {
  const businessPopup = input.audience === "both" && input.businessPopup;
  await db().execute(sql`
    update commerce.stores set audience = ${input.audience}, business_popup = ${businessPopup}
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, "store.audience_updated", { audience: input.audience, businessPopup });
}

/** The shopper's kind in this store (B2B), from the store's audience and the shopper's choice. Per request. */
export async function getBuyer(store: Pick<Store, "id" | "audience">): Promise<Buyer> {
  if (store.audience !== "both") return storeBuyer(store.audience, null);
  return storeBuyer(store.audience, parseBuyer((await cookies()).get(buyerCookie(store.id))?.value));
}

/** Marks this browser as buying for a business (B2B), as the header's switch would. */
export async function chooseBusinessBuyer(storeId: string): Promise<void> {
  // Read by the page's first script, so not httpOnly; it holds nothing but the choice.
  (await cookies()).set(buyerCookie(storeId), "business", {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BUYER_DAYS * 24 * 60 * 60,
  });
}
