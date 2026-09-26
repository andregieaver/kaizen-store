import Link from "next/link";
import { Suspense } from "react";

import { t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { linkExists, menuHref, menuLabel, termNames, type MenuItem } from "@/lib/navigation";
import { marketPath } from "@/lib/paths";
import { darkBehindLogo, type HeaderBackground, type LogoPlace } from "@/lib/theme";
import { publishedPageNames } from "@/server/pages";
import type { Store } from "@/server/stores";
import { siteTerms } from "@/server/taxonomy";

import { BuyerSwitch } from "./buyer";
import { CartLink, CartLinkShell } from "./cart-link";
import { WishlistCount } from "./wishlist-heart";
import { Icon } from "./icons";
import { LogoPicture } from "./logo-picture";
import { HidingBottomBar, HidingHeader, MobileMenu } from "./store-chrome";

/**
 * The storefront's header, footer and phone bottom bar (D30), from the
 * store's logo and menus. Rendered once per store and country, and cached
 * with the store; only the cart counts are per shopper.
 */

type Props = { store: Store; market: Market };

async function MenuLinks({
  items,
  store,
  market,
  className,
  linkClassName,
}: Props & { items: MenuItem[]; className?: string; linkClassName: string }) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const builtIn = { home: store.frontPageId ? m.home : m.allProducts, account: m.account.title, cart: m.cart, blog: m.blog };
  // Page, article, category and tag links (D50, D54, D57) are named after them, and left out once they are gone.
  const [terms, pages, articles, blogTerms] = await Promise.all([
    siteTerms(store.id, "product"),
    publishedPageNames(store.id, market.locale),
    publishedPageNames(store.id, market.locale, "article"),
    siteTerms(store.id, "article"),
  ]);
  const names = {
    ...termNames(terms),
    page: new Map(pages),
    article: new Map(articles),
    blogCategory: termNames(blogTerms).category,
  };
  return (
    <ul className={className}>
      {items.filter((item) => linkExists(item.link, names)).map((item, index) => {
        const { href, external } = menuHref(item.link, base, names);
        const text = menuLabel(item, market.locale, builtIn, names);
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

/**
 * The logo, or the store's name without one. Where the theme puts it on a
 * dark background, the logo for dark backgrounds is shown instead (D60).
 */
function Brand({ store, market, size, place = size === "header" ? "header" : "page" }: Props & { size: "header" | "footer"; place?: LogoPlace }) {
  const logo = store.navigation.logo;
  return (
    <Link href={marketPath(store.slug, market.slug)} className="flex min-w-0 items-center">
      {logo ? (
        <LogoPicture
          logo={logo}
          logoDark={store.navigation.logoDark}
          darkBehind={darkBehindLogo(store.theme.settings, place)}
          alt={store.name}
          priority={size === "header"}
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
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-button px-3 text-sm hover:bg-current/5 [&::-webkit-details-marker]:hidden">
        <Icon name="globe" className="size-5" />
        {market.name}
        <Icon name="chevron" className="size-4 transition-transform group-open:rotate-180" />
        <span className="sr-only">· {m.chooseMarket}</span>
      </summary>
      <ul className="absolute right-0 z-10 mt-2 min-w-44 rounded-lg border border-border bg-background p-1 text-foreground shadow-lg">
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
/** The header's background by the theme (D60); hovers use the text's own colour, so they suit each. */
const HEADER_BACKGROUND: Record<HeaderBackground, string> = {
  page: "bg-background/95 backdrop-blur",
  surface: "bg-surface",
  accent: "bg-accent text-accent-foreground",
  inverse: "bg-foreground text-background",
};

export function StoreHeader({ store, market, notice }: Props & { notice: string | null }) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const header = store.navigation.header;
  const layout = store.theme.settings.layout;
  // The logo on the left with the menu beside it, or in the middle with the menu below (D60).
  const centred = layout.headerAlign === "center";

  const menuButton = (
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
  );
  const menu = (className: string) =>
    header.length > 0 && (
      <nav aria-label={m.mainMenu} className={className}>
        <MenuLinks
          items={header}
          store={store}
          market={market}
          className={`flex flex-wrap items-center gap-1 ${centred ? "justify-center" : ""}`}
          linkClassName="flex min-h-11 items-center rounded-button px-3 text-sm font-medium hover:bg-current/5"
        />
      </nav>
    );
  const tools = (
    <div className={`flex items-center gap-1 ${centred ? "justify-end" : "ml-auto"}`}>
      <MarketChoice store={store} market={market} m={m} />
      <Link
        href={`${base}/account`}
        className="hidden size-11 items-center justify-center rounded-full hover:bg-current/5 md:flex"
      >
        <Icon name="user" />
        <span className="sr-only">{m.account.title}</span>
      </Link>
      <Link href={`${base}/wishlist`} className="relative flex size-11 items-center justify-center rounded-full hover:bg-current/5">
        <Icon name="heart" />
        <WishlistCount base={base} />
        <span className="sr-only">{m.wishlist.title}</span>
      </Link>
      <Suspense fallback={<CartLinkShell storeSlug={store.slug} market={market} />}>
        <CartLink storeId={store.id} storeSlug={store.slug} market={market} />
      </Suspense>
    </div>
  );

  return (
    <HidingHeader>
      {notice && <p className="bg-foreground px-4 py-2 text-center text-sm text-background">{notice}</p>}
      {store.audience === "both" && (
        <div className={`border-b border-border ${HEADER_BACKGROUND[layout.headerBackground]}`}>
          <div className="mx-auto flex max-w-(--content-width) justify-end px-4 py-1">
            <BuyerSwitch storeId={store.id} labels={m.buyer} />
          </div>
        </div>
      )}
      <header className={`border-b border-border ${HEADER_BACKGROUND[layout.headerBackground]}`}>
        {centred ? (
          <>
            <div className="mx-auto grid h-16 max-w-(--content-width) grid-cols-[1fr_auto_1fr] items-center gap-2 px-4">
              <div className="flex items-center">{menuButton}</div>
              <Brand store={store} market={market} size="header" />
              {tools}
            </div>
            {menu("mx-auto hidden max-w-(--content-width) px-4 pb-2 md:block")}
          </>
        ) : (
          <div className="mx-auto flex h-16 max-w-(--content-width) items-center gap-2 px-4 md:gap-6">
            {menuButton}
            <Brand store={store} market={market} size="header" />
            {menu("hidden min-w-0 flex-1 md:block")}
            {tools}
          </div>
        )}
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
      title={<Brand store={store} market={market} size="header" place="page" />}
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
                  className="flex min-h-11 items-center rounded-button border border-border px-4 text-sm aria-[current=page]:border-foreground aria-[current=page]:font-semibold"
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
      <div className="mx-auto grid max-w-(--content-width) gap-8 px-4 py-10 text-sm sm:grid-cols-2 md:grid-cols-4">
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
          {/* What the store stores in the browser, and the choice about it (D58). */}
          <Link href={marketPath(store.slug, market.slug, "/cookies")} className="w-fit text-muted underline">
            {m.cookies}
          </Link>
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
