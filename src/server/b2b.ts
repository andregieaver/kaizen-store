import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { STORE_AUDIENCES } from "@/lib/b2b";

import { audit, type Membership } from "./auth";

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
