import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { deskAddress, deskTakesReplies, inboundDomain } from "@/lib/inbound-email";

import { col, typedRow } from "./typed-rows";

/**
 * The address a store's email about an order asks replies to go to, when its support desk takes them (ecosystem plan E1.4,
 * `deskTakesReplies()`): the desk's own address, so a customer's "where is my parcel?" lands in the inbox with the rest. Null while
 * receiving is not set up or the desk does not take replies; the email then keeps the store's contact address.
 */
export async function deskReplyTo(storeId: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const domain = inboundDomain(env.SUPPORT_INBOUND_DOMAIN);
  if (!domain) return null;
  const desk = await typedRow(
    z.object({ mode: col.text, form_messages: col.textOrNull, email_key: col.textOrNull }),
    sql`select mode, form_messages, email_key from commerce.support_settings where store_id = ${storeId}::uuid`,
  );
  if (!desk || !desk.email_key) return null;
  return deskTakesReplies({ mode: desk.mode, formMessages: desk.form_messages, emailKey: desk.email_key }) ? deskAddress(desk.email_key, domain) : null;
}
