import Link from "next/link";
import { Suspense } from "react";

import { t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { menuHref, menuLabel, type MenuItem } from "@/lib/navigation";
import { marketPath } from "@/lib/paths";
import type { Store } from "@/server/stores";

import { CartLink, CartLinkShell } from "./cart-link";
import { Icon } from "./icons";
import { HidingBottomBar, HidingHeader, MobileMenu } from "./store-chrome";

/**
 * The storefront's header, footer and phone bottom bar (D30), from the
 * store's logo and menus. Rendered once per store and country, and cached
 * with the store; only the cart counts are per shopper.
 */

type Props = { store: Store; market: Market };

function MenuLinks({
  items,
  store,
  market,
  className,
  linkClassName,
}: Props & { items: MenuItem[]; className?: string; linkClassName: string }) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const builtIn = { home: m.allProducts, account: m.account.title, cart: m.cart };
  return (
    <ul className={className}>
      {items.map((item, index) => {
        const { href, external } = menuHref(item.link, base);
        const text = menuLabel(item, market.locale, builtIn);
        return (
          <li key={`${index}-${href}`}>
            {external ? (
              <a href={href} rel="noopener" className={linkClassName}>
                {text}
              </a>
            ) : (
              <Link href={href} className={linkClassName}>
                {text}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The logo, or the store's name without one. */
function Brand({ store, market, size }: Props & { size: "header" | "footer" }) {
  const logo = store.navigation.logo;
  return (
    <Link href={marketPath(store.slug, market.slug)} className="flex min-w-0 items-center">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small logo of known size, not worth resizing
        <img
          src={logo.url}
          alt={store.name}
          width={logo.width}
          height={logo.height}
          fetchPriority={size === "header" ? "high" : undefined}
          className={`${size === "header" ? "h-8 md:h-10" : "h-8"} w-auto max-w-44 object-contain object-left md:max-w-56`}
        />
      ) : (
        <span className="truncate text-lg font-semibold">{store.name}</span>
      )}
    </Link>
  );
}

function MarketChoice({ store, market, m }: Props & { m: Messages }) {
  if (store.markets.length < 2) return null;
  return (
    <details className="group relative hidden md:block">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full px-3 text-sm hover:bg-surface [&::-webkit-details-marker]:hidden">
        <Icon name="globe" className="size-5" />
        {market.name}
        <Icon name="chevron" className="size-4 transition-transform group-open:rotate-180" />
        <span className="sr-only">· {m.chooseMarket}</span>
      </summary>
      <ul className="absolute right-0 mt-2 min-w-44 rounded-lg border border-border bg-background p-1 shadow-lg">
        {store.markets.map((other) => (
          <li key={other.slug}>
            <Link
              href={marketPath(store.slug, other.slug)}
              hrefLang={other.lang}
              lang={other.lang}
              aria-current={other.slug === market.slug ? "page" : undefined}
              className="block rounded-md px-3 py-2 text-sm hover:bg-surface aria-[current=page]:font-semibold"
            >
              {other.name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The store's notice (preview, demo or test payments), then its header; both slide away together. */
export function StoreHeader({ store, market, notice }: Props & { notice: string | null }) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const header = store.navigation.header;
  return (
    <HidingHeader>
      {notice && <p className="bg-foreground px-4 py-2 text-center text-sm text-background">{notice}</p>}
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4 md:gap-6">
          <button
            type="button"
            data-open-menu
            aria-haspopup="dialog"
            aria-controls="store-menu"
            className="-ml-2 flex size-11 items-center justify-center rounded-full md:hidden"
          >
            <Icon name="menu" />
            <span className="sr-only">{m.openMenu}</span>
          </button>

          <Brand store={store} market={market} size="header" />

          {header.length > 0 && (
            <nav aria-label={m.mainMenu} className="hidden min-w-0 flex-1 md:block">
              <MenuLinks
                items={header}
                store={store}
                market={market}
                className="flex flex-wrap items-center gap-1"
                linkClassName="flex min-h-11 items-center rounded-full px-3 text-sm font-medium hover:bg-surface"
              />
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1">
            <MarketChoice store={store} market={market} m={m} />
            <Link
              href={`${base}/account`}
              className="hidden size-11 items-center justify-center rounded-full hover:bg-surface md:flex"
            >
              <Icon name="user" />
              <span className="sr-only">{m.account.title}</span>
            </Link>
            <Suspense fallback={<CartLinkShell storeSlug={store.slug} market={market} />}>
              <CartLink storeId={store.id} storeSlug={store.slug} market={market} />
            </Suspense>
          </div>
        </div>
      </header>
    </HidingHeader>
  );
}

/** The phone's slide-out menu, placed after the page's content (see `MobileMenu`). */
export function StoreMenu({ store, market }: Props) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const header = store.navigation.header;
  return (
    <MobileMenu
      title={<Brand store={store} market={market} size="header" />}
      labels={{ close: m.closeMenu, menu: m.menu }}
    >
      {header.length > 0 && (
        <nav aria-label={m.mainMenu}>
          <MenuLinks
            items={header}
            store={store}
            market={market}
            className="flex flex-col"
            linkClassName="flex min-h-12 items-center border-b border-border text-lg"
          />
        </nav>
      )}
      <ul className="flex flex-col">
        <li>
          <Link href={`${base}/account`} className="flex min-h-12 items-center gap-3">
            <Icon name="user" /> {m.account.title}
          </Link>
        </li>
        <li>
          <Link href={`${base}/cart`} className="flex min-h-12 items-center gap-3">
            <Icon name="bag" /> {m.cart}
          </Link>
        </li>
      </ul>
      {store.markets.length > 1 && (
        <nav aria-label={m.chooseMarket} className="mt-auto">
          <p className="mb-2 text-sm text-muted">{m.chooseMarket}</p>
          <ul className="flex flex-wrap gap-2">
            {store.markets.map((other) => (
              <li key={other.slug}>
                <Link
                  href={marketPath(store.slug, other.slug)}
                  hrefLang={other.lang}
                  lang={other.lang}
                  aria-current={other.slug === market.slug ? "page" : undefined}
                  className="flex min-h-11 items-center rounded-full border border-border px-4 text-sm aria-[current=page]:border-foreground aria-[current=page]:font-semibold"
                >
                  {other.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </MobileMenu>
  );
}

/**
 * Who sells (required on every page of a web shop, by e-commerce and
 * consumer law), the footer menu and the countries.
 */
export function StoreFooter({ store, market }: Props) {
  const m = t(market.lang);
  const d = store.navigation;
  const details = store.details;
  const legal = [details.legalName ?? store.name, details.organisationNumber && `Org. ${details.organisationNumber}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <footer className="mt-auto border-t border-border bg-surface/40">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 md:grid-cols-4">
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Brand store={store} market={market} size="footer" />
          <address className="flex flex-col gap-1 not-italic text-muted">
            <span>{legal}</span>
            {details.postalAddress && <span>{details.postalAddress.replace(/\s*\n\s*/g, ", ")}</span>}
            {details.contactEmail && (
              <a href={`mailto:${details.contactEmail}`} className="w-fit underline">
                {details.contactEmail}
              </a>
            )}
          </address>
        </div>
        {d.footer.length > 0 && (
          <nav aria-label={m.footerMenu}>
            <MenuLinks
              items={d.footer}
              store={store}
              market={market}
              className="flex flex-col gap-1"
              linkClassName="inline-flex min-h-10 items-center hover:underline"
            />
          </nav>
        )}
        {store.markets.length > 1 && (
          <nav aria-label={m.chooseMarket}>
            <ul className="flex flex-col gap-1">
              {store.markets.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={marketPath(store.slug, other.slug)}
                    hrefLang={other.lang}
                    lang={other.lang}
                    aria-current={other.slug === market.slug ? "page" : undefined}
                    className="inline-flex min-h-10 items-center hover:underline aria-[current=page]:font-semibold"
                  >
                    {other.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </footer>
  );
}

/** Phones: the way round the store, at the thumb; product pages put their own bar here. */
export function StoreBottomBar({ store, market }: Props) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const item = "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs";
  return (
    <HidingBottomBar>
      <nav aria-label={m.shortcuts} className="flex">
        <Link href={base} className={item}>
          <Icon name="home" />
          {m.home}
        </Link>
        {/* The slide-out menu opens on any `data-open-menu` button. */}
        <button type="button" data-open-menu aria-haspopup="dialog" aria-label={m.openMenu} className={item}>
          <Icon name="menu" />
          {m.menu}
        </button>
        <Link href={`${base}/account`} className={item}>
          <Icon name="user" />
          {m.account.title}
        </Link>
        <Suspense fallback={<CartLinkShell storeSlug={store.slug} market={market} variant="bar" />}>
          <CartLink storeId={store.id} storeSlug={store.slug} market={market} variant="bar" />
        </Suspense>
      </nav>
    </HidingBottomBar>
  );
}
