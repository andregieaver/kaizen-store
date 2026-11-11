"use client";

import { useEffect, useState } from "react";

import { tileShows, type TileAsk, type TileFact, type TileFactsAnswer } from "@/lib/shop-tiles";

import { AddToCart, type AddToCartLabels } from "./add-to-cart";
import type { QuantityStepperLabels } from "./quantity-stepper";

/** The words a tile's chooser uses, in the page's language, handed down by the grid; the stock's own sentence comes with the facts. */
export type TileShopWords = { cart: AddToCartLabels; quantity: QuantityStepperLabels };

type Where = { store: string; market: string };

/*
 * One ask for every tile of a page (D556): each island names its product, and the ids gathered in the same tick go in one request, whose
 * answer every island of that store and market reads. A later batch (a grid filtered afresh) asks again.
 */
const batches = new Map<string, { ids: Set<string>; answer: Promise<TileFactsAnswer | null> }>();

function factsFor(where: Where, productId: string): Promise<TileFactsAnswer | null> {
  const key = `${where.store}|${where.market}`;
  const open = batches.get(key);
  if (open) {
    open.ids.add(productId);
    return open.answer;
  }
  const ids = new Set([productId]);
  const answer = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () => {
    batches.delete(key);
    const query = new URLSearchParams({ store: where.store, market: where.market, ids: [...ids].join(",") });
    try {
      const response = await fetch(`/api/shop/tiles?${query}`, { headers: { accept: "application/json" } });
      return response.ok ? ((await response.json()) as TileFactsAnswer) : null;
    } catch {
      return null;
    }
  });
  batches.set(key, { ids, answer });
  return answer;
}

/**
 * What a product's tile shows besides its picture, title and price (D556): the stock left and, for a product that can be bought from
 * there, a quantity chooser with Add to cart, as the store's settings and the grid's own choices say. Nothing is drawn until the facts
 * arrive, and nothing at all without scripts: the tile still links to the product's page, where both are.
 */
export function TileShop({ productId, where, cart, ask, words }: { productId: string; where: Where; cart: string; ask: TileAsk; words: TileShopWords }) {
  const [seen, setSeen] = useState<{ fact: TileFact; shows: { stock: boolean; quantity: boolean }; buttons: boolean } | null>(null);
  const { store, market } = where;
  const { stock: askStock, quantity: askQuantity } = ask;
  useEffect(() => {
    let live = true;
    void factsFor({ store, market }, productId).then((answer) => {
      const fact = answer?.facts[productId];
      if (live && answer && fact) setSeen({ fact, shows: tileShows({ stock: askStock, quantity: askQuantity }, answer.settings), buttons: answer.buttons });
    });
    return () => {
      live = false;
    };
  }, [store, market, productId, askStock, askQuantity]);
  if (!seen) return null;
  const { fact, shows, buttons } = seen;
  const line = shows.stock ? (fact.stock?.text ?? null) : null;
  const buy = shows.quantity ? fact.buy : null;
  if (!line && !buy) return null;
  return (
    <div className="flex flex-col gap-2" data-tile-shop="">
      {line && (
        <p className={`text-sm ${fact.stock?.kind === "out" ? "text-muted" : ""}`} data-kz-text="meta" data-tile-stock={fact.stock?.kind}>
          {line}
        </p>
      )}
      {buy && (
        <div className="relative z-[2] [&_form]:items-start [&_form>div]:justify-start">
          <AddToCart
            store={where.store}
            market={where.market}
            cartHref={cart}
            variantId={buy.variantId}
            disabled={!buy.canBuy}
            labels={words.cart}
            openCart
            quantity={{ rule: buy.rule, buttons, labels: words.quantity }}
          />
        </div>
      )}
    </div>
  );
}
