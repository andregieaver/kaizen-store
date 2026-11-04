import "server-only";

import { COPY_FEEDS, copyDone, copyMoving, copyReady } from "@/lib/shopify-copy";
import { MOVE_STEPS } from "@/lib/shopify-move";

import { passMembership, type Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { addressView } from "./shopify-address";
import { shopifyConnection } from "./shopify-connect";
import { copyView } from "./shopify-copy";
import { makersView } from "./shopify-makers";
import { moveView, watchView } from "./shopify-move";
import { undoView } from "./shopify-undo";
import type { Store } from "./stores";

type Ctx = { account: Account; store: Store };

/**
 * `shopify_move` (D445 step 9, `docs/moving-from-shopify.md` 11): where the store's move from Shopify stands, for the *Moving from Shopify*
 * skill. The connection, each part of the copy (its stage, how many were found and how many need a look), *Ready to move?*, the move's
 * steps, the address, the 14 days after (whether Shopify can close) and whether the copy can be undone. States, counts and page ids only:
 * nothing a person typed on Shopify (a product's words, a page's) is in it. Read-only; it presses nothing. The owner's.
 */
export async function shopifyMoveTool(ctx: Ctx) {
  const member = await passMembership(ctx.store.slug, ctx.account.id);
  if (!member) throw new OwnerToolError("Only the store's owner can look at the move from Shopify.");
  const connection = await shopifyConnection(member);
  if (!connection) {
    return {
      connected: false,
      next: "Nothing is connected. The owner connects their Shopify shop on Moving in (open_admin_page, settings.moving): Shopify asks them to allow it there, so you cannot do it for them.",
      page: "settings.moving",
    };
  }
  const [copy, makers, move, watch, undo] = await Promise.all([copyView(member), makersView(member), moveView(member), watchView(member), undoView(member)]);
  const state = copy?.state ?? null;
  const address = move?.state.status === "moved" ? await addressView(member).catch(() => null) : null;
  return {
    connected: true,
    shop: connection.name || connection.shop,
    copy: state
      ? {
          started: state.startedAt !== null,
          brought_over: state.apply,
          still_working: copyMoving(state),
          ready_to_bring_over: copyReady(state),
          done: copyDone(state),
          parts: COPY_FEEDS.map((feed) => {
            const f = state.feeds[feed];
            return { part: feed, stage: f.stage, ...(f.count !== undefined ? { found: f.count } : {}), ...(f.refused ? { need_a_look: f.refused } : {}), ...(f.problem ? { problem: f.problem } : {}) };
          }),
        }
      : null,
    products_still_without_a_maker: (makers?.groups ?? []).reduce((n, g) => n + g.count, 0),
    ready_to_move: move ? { can_move: move.canMove, checks: move.checks.map((c) => ({ check: c.key, ok: c.ok, holds_the_move_back: c.blocks })) } : null,
    move: move
      ? {
          status: move.state.status,
          ...(move.state.at ? { scheduled_for: move.state.at } : {}),
          steps: MOVE_STEPS.map((step) => ({ step, stage: move.state.steps[step].stage, ...(move.state.steps[step].problem ? { problem: move.state.steps[step].problem } : {}) })),
          gift_cards_without_email: move.state.steps.gift_cards.left?.length ?? 0,
        }
      : null,
    address: address
      ? { has_own_domain: address.primary !== null, domain: address.primary, leads_here: address.done, dns_kept_at: address.dnsHost, names: address.hosts.map((h) => ({ name: h.hostname, status: h.status, still_answers_from_shopify: h.atShopify })) }
      : null,
    after_the_move: watch
      ? { day: watch.day, of_days: watch.days, address_leads_here: watch.addressDone, old_links_leading_nowhere: watch.linksMissing, orders_that_still_came_in_on_shopify: watch.found, can_close_shopify: watch.canClose }
      : null,
    undo: undo ? { can_undo: undo.allowed, ...(undo.reason ? { why_not: undo.reason } : {}) } : null,
    page: "settings.moving",
    note: "The owner presses Copy my shop, Bring it over, Move my shop, Undo this copy and every step on Shopify themselves: you explain and open the page (settings.moving), never press them. Repeat the counts as given.",
  };
}
