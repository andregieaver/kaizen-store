import "server-only";

import type { ChatSite } from "./chat-agent";

/**
 * A support desk (D216, `docs/support.md` 4.5): a store's, or Kaizen's (`storeId` null). Every reader and writer in
 * `src/server/support*.ts` takes one, and only this module makes one, each after its own check, so a desk in hand means the check
 * was made. A scan test fails for `as Desk` anywhere else.
 */

declare const deskBrand: unique symbol;
export type Desk = { readonly storeId: string | null; readonly [deskBrand]: true };

const make = (storeId: string | null): Desk => ({ storeId }) as Desk;

/**
 * The desk a visitor writes to: the site the chat route resolved (a store in one of its countries through `resolveShop()`, which
 * is a 404 for a store that is not open, or Kaizen's). The conversation's own token is checked by `visitorConversation()`.
 */
export function visitorDesk(site: ChatSite): Desk {
  return make(site.kind === "store" ? site.store.id : null);
}

/** A desk for the platform's own jobs (ending idle conversations, retention, erasure), which act on every store's data by design. */
export function systemDesk(storeId: string | null): Desk {
  return make(storeId);
}
