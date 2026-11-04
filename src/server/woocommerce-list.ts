import "server-only";

import { LIST_RECORDED_BY, readListExport, type ListProblem, type ListSource } from "@/lib/list-export";
import { movedSubscriber } from "@/lib/shopify-subscribers";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { addMovedSubscribers } from "./marketing-subscribers";
import { memberCan } from "./permissions";
import { recordMoveItems } from "./shopify-undo";
import { wooConnection } from "./woocommerce-connect";

/**
 * A WooCommerce shop's email list kept in Mailchimp or Klaviyo (D446 step 2b, the owner's Decision 2): the owner uploads its export, and only
 * the rows it says are subscribed, with the moment they subscribed, become subscribers here, through the email list's own writer
 * (`addMovedSubscribers()`, `source` `woocommerce`, the service's record as the words kept with the consent). Someone already on the list is
 * left as they are. What it adds is written down for *Undo this copy*. Read in one request and kept nowhere. The owner's, while a WooCommerce
 * shop is connected.
 */
export type ListImport =
  | { ok: true; source: ListSource; added: number; already: number; skipped: number }
  | { ok: false; problem: ListProblem | "forbidden" | "disconnected" };

export async function importListExport(member: Membership, bytes: Uint8Array): Promise<ListImport> {
  if (!memberCan(member, "owner")) return { ok: false, problem: "forbidden" };
  const shop = await wooConnection(member);
  if (!shop) return { ok: false, problem: "disconnected" };
  const read = readListExport(bytes);
  if (!read.ok) return read;
  const by = LIST_RECORDED_BY[read.source];
  const subscribers = read.lines.flatMap((line) => {
    const sub = movedSubscriber(line, shop.name || member.store.name, "woocommerce", by);
    return sub ? [sub] : [];
  });
  const result = await addMovedSubscribers(member.store.id, member.store.localization.locales[0] ?? "en", subscribers, "woocommerce");
  await recordMoveItems(member.store.id, "subscriber", result.ids);
  await audit(member.account.id, member.store.id, "integration.woocommerce_list_imported", { source: read.source, added: result.added, already: result.already, skipped: read.skipped }, { area: "settings" }).catch(
    (error) => log("error", "woocommerce.audit_failed", { storeId: member.store.id }, error),
  );
  log("info", "woocommerce.list_imported", { storeId: member.store.id, source: read.source, added: result.added, already: result.already, skipped: read.skipped });
  return { ok: true, source: read.source, added: result.added, already: result.already, skipped: read.skipped };
}
