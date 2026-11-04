import Link from "next/link";

import { Card } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { Membership } from "@/server/auth";
import { watchView } from "@/server/shopify-move";

import { overWords } from "@/lib/over-words";

import { ShopifyClosedButton } from "./shopify-closed-button";

/** WordPress's own help on deactivating a plugin (D446: the owner's own press there). */
const WORDPRESS_HELP = {
  plugins: "https://wordpress.org/documentation/article/manage-plugins/",
};

/** Shopify's own help on what the owner does there (we never press anything on Shopify). */
const SHOPIFY_HELP = {
  apps: "https://help.shopify.com/en/manual/apps/working-with-apps",
  close: "https://help.shopify.com/en/manual/your-account/pause-close-store",
};

/**
 * *Your move* (D445 step 7c, `docs/moving-from-shopify.md` 4.8): for the 14 days after a move, on the store's home and on Moving in, one card
 * that says *All good* or what needs a press (the address, old links that lead nowhere, orders still arriving on Shopify, copied here by the
 * daily look); then *You can close Shopify now*, with the owner's own steps there, until they say it is closed. The owner's; nothing for
 * anyone else.
 */
export async function MoveWatchCard({
  member,
  lang,
  close,
  level = 2,
}: {
  member: Membership;
  lang: AdminLang;
  close: () => Promise<{ ok: boolean }>;
  level?: 2 | 3;
}) {
  const view = await watchView(member).catch(() => null);
  if (!view) return null;
  const all = adminText(lang, "moving");
  const woo = view.source === "woocommerce";
  // A WooCommerce shop's words (D446) over the shared ones; its closing steps are its own.
  const w = woo ? overWords(all.watch, all.woo.watch) : all.watch;
  const wc = all.woo.watch.close;
  const base = `/admin/${member.store.slug}`;
  const good = view.addressDone !== false && view.linksMissing === 0;
  const tick = "text-body text-ink";
  return (
    <Card
      level={level}
      title={view.canClose ? w.close.title : w.title}
      aside={fillWords(w.day, { day: view.day, days: view.days })}
    >
      <ul className="flex flex-col gap-1">
        {view.addressDone !== null && (
          <li className={tick}>
            {view.addressDone ? (
              w.address.ok
            ) : (
              <>
                {w.address.no}{" "}
                <Link
                  href={`${base}/settings/moving#shop-address`}
                  className="underline underline-offset-2"
                >
                  {w.addressFix}
                </Link>
              </>
            )}
          </li>
        )}
        <li className={tick}>
          {view.linksMissing === 0 ? (
            w.links.ok
          ) : (
            <>
              {countWords(view.linksMissing, w.links.no)}{" "}
              <Link
                href={`${base}/redirects/old-shop`}
                className="underline underline-offset-2"
              >
                {w.linksFix}
              </Link>
            </>
          )}
        </li>
        <li className={tick}>
          {view.found === null ? (
            w.orders.waiting
          ) : view.found === 0 ? (
            w.orders.none
          ) : (
            <>
              {countWords(view.found, w.orders.some)}{" "}
              <Link
                href={`${base}/orders`}
                className="underline underline-offset-2"
              >
                {w.ordersLook}
              </Link>
            </>
          )}
        </li>
        {view.cardsLowered > 0 && (
          <li className={tick}>
            {countWords(view.cardsLowered, w.cardsLowered)}
          </li>
        )}
      </ul>
      {view.canClose ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-body text-ink">{w.close.text}</p>
          {woo ? (
            <ol className="list-decimal pl-5 text-body text-ink">
              {view.wordpress === "keep" ? (
                <li>{wc.moved}</li>
              ) : (
                <li>{wc.backup}</li>
              )}
              {view.cardsMoved && <li>{wc.giftCards}</li>}
              {view.wordpress === "keep" ? (
                <li>
                  {wc.deactivate}{" "}
                  <a
                    href={WORDPRESS_HELP.plugins}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {wc.how}
                  </a>
                </li>
              ) : (
                <li>{wc.hosting}</li>
              )}
            </ol>
          ) : (
            <ol className="list-decimal pl-5 text-body text-ink">
              <li>
                {w.close.apps}{" "}
                <a
                  href={SHOPIFY_HELP.apps}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {w.close.how}
                </a>
              </li>
              {view.cardsMoved && <li>{w.close.giftCards}</li>}
              <li>
                {w.close.plan}{" "}
                <a
                  href={SHOPIFY_HELP.close}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {w.close.how}
                </a>
              </li>
            </ol>
          )}
          {!woo && <p className="text-body text-muted">{w.close.export}</p>}
          <div>
            <ShopifyClosedButton
              label={w.close.done}
              saving={w.close.saving}
              close={close}
            />
          </div>
        </div>
      ) : (
        good &&
        view.found !== null &&
        view.found === 0 && (
          <p className="mt-3 text-body text-muted">{w.allGood}</p>
        )
      )}
    </Card>
  );
}
