import Link from "next/link";
import { Suspense } from "react";

import { t, type Messages } from "@/lib/i18n";
import { currencyChoices, currencyName, languageChoices, languageName } from "@/lib/localization";
import { marketSlug } from "@/lib/market-slug";
import type { Market } from "@/lib/markets";
import { linkExists, menuHref, menuLabel, menuTree, shopLink, termNames, type MenuEntry, type MenuNode } from "@/lib/navigation";
import { marketPath, storeBase } from "@/lib/paths";
import { featureOn } from "@/lib/store-features";
import { darkBehindLogo, type HeaderBackground, type LogoPlace } from "@/lib/theme";
import { publishedPageNames } from "@/server/pages";
import type { Store } from "@/server/stores";
import { siteTerms } from "@/server/taxonomy";

import { BuyerSwitch } from "./buyer";
import { CartLink, CartLinkShell } from "./cart-link";
import { WishlistCount } from "./wishlist-heart";
import { Icon } from "./icons";
import { LogoPicture } from "./logo-picture";
import { StoreColorSwitch } from "./store-color-switch";
import { ViewMenu, type ViewItem } from "./view-menu";
import { MenuTreeView, type MenuLayout, type MenuLinkNode } from "./menu-view";
import { HidingBottomBar, HidingHeader, MobileMenu } from "./store-chrome";

/**
 * The storefront's header, footer and phone bottom bar (D30), from the
 * store's logo and menus. Rendered once per store and country, and cached
 * with the store; only the cart counts are per shopper.
 */

type Props = { store: Store; market: Market };

/** A published legal page of the store (wave 1, 1e): what `legalLinksFor()` finds. */
type LegalLink = { role: string; title: string; href: string };

/** A store's menu by id (D85): its items, or none. */
export function storeMenu(store: Store, id: string | null | undefined): MenuEntry[] {
  return (id && store.menus.find((menu) => menu.id === id)?.items) || [];
}

/**
 * A store's menu (D85) in the shopper's language: page, article, category
 * and tag links (D50, D54, D57) named after them, and left out once they are
 * gone (the links under one take its place).
 */
export async function MenuLinks({
  items,
  store,
  market,
  layout,
  linkClassName,
  justify,
}: Props & { items: MenuEntry[]; layout: MenuLayout; linkClassName: string; justify?: string }) {
  if (items.length === 0) return null;
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  // A website (D178 step 5: the online shop off) has no products, categories, tags, cart or My account to link to: those links are left out.
  const selling = featureOn(store, "shop");
  const builtIn = { home: store.frontPageId || !selling ? m.home : m.allProducts, products: m.allProducts, account: m.account.title, cart: m.cart, blog: m.blog };
  const [terms, pages, articles, blogTerms] = await Promise.all([
    selling ? siteTerms(store.id, "product") : Promise.resolve([]),
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
  const toNode = ({ item, children }: MenuNode<MenuEntry>, index: number): MenuLinkNode => {
    const { href, external } = menuHref(item.link, base, names);
    return {
      key: `${index}-${href}`,
      href,
      external,
      newTab: Boolean(item.newTab),
      text: menuLabel(item, market.locale, builtIn, names),
      ...(item.depth === 0 && item.mega && { mega: item.mega }),
      ...(item.image && { image: item.image }),
      children: children.map(toNode),
    };
  };
  // A link with nothing to say (no text of its own and no name to take) is left out too.
  const nodes = menuTree(
    items,
    (item) => (selling || !shopLink(item.link)) && linkExists(item.link, names) && menuLabel(item, market.locale, builtIn, names) !== "",
  ).map(toNode);
  return <MenuTreeView nodes={nodes} layout={layout} linkClassName={linkClassName} newTabLabel={m.opensInNewTab} justify={justify} />;
}

/**
 * The logo, or the store's name without one. Where the theme puts it on a
 * dark background, the logo for dark backgrounds is shown instead (D60).
 */
export function Brand({
  store,
  market,
  size,
  place = size === "header" ? "header" : "page",
  height,
}: Props & { size: "header" | "footer"; place?: LogoPlace; height?: number }) {
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
          // A height set in a header or footer layout (D80), else the usual one.
          style={height ? { height } : undefined}
          className={`${height ? "max-w-none" : `${size === "header" ? "h-8 md:h-10" : "h-8"} max-w-44 md:max-w-56`} w-auto min-w-0 object-contain object-left`}
        />
      ) : (
        <span className="truncate text-lg font-semibold">{store.name}</span>
      )}
    </Link>
  );
}

/** The languages and currencies a shopper in this country can choose, as links that keep the other choice (D109). */
function viewChoices(store: Store, market: Market): { languages: ViewItem[]; currencies: ViewItem[] } {
  const own = { lang: market.ownLocale.split("-")[0], currency: market.nativeCurrency };
  const languages = languageChoices(store.localization, market).map((locale) => {
    const lang = locale.split("-")[0];
    return {
      key: locale,
      label: languageName(locale),
      lang,
      slug: marketSlug(market.code, { lang, currency: market.currency }, own),
      current: lang === market.lang,
    };
  });
  const currencies = currencyChoices(store.localization, market.nativeCurrency).map((currency) => ({
    key: currency,
    label: currencyName(currency, market.locale),
    slug: marketSlug(market.code, { lang: market.lang, currency }, own),
    current: currency === market.currency,
  }));
  return { languages: languages.length > 1 ? languages : [], currencies: currencies.length > 1 ? currencies : [] };
}

/** Whether a shopper in this country has a language or a currency to choose (D109, D178). */
export function hasViewChoices(store: Store, market: Market): boolean {
  const { languages, currencies } = viewChoices(store, market);
  return languages.length > 0 || currencies.length > 0;
}

/** The language and currency choices (D109): each a menu, or with `list` a row of links. */
export function LocaleChoice({ store, market, m, className = "", list = false }: Props & { m: Messages; className?: string; list?: boolean }) {
  const { languages, currencies } = viewChoices(store, market);
  if (languages.length === 0 && currencies.length === 0) return null;
  const prefix = storeBase(store.slug);
  return (
    <div className={`flex ${list ? "flex-col gap-3" : "items-center"} ${className}`}>
      {languages.length > 0 && (
        <ViewMenu icon={null} summary={market.lang.toUpperCase()} srLabel={m.chooseLanguage} items={languages} prefix={prefix} currentSlug={market.slug} list={list} />
      )}
      {currencies.length > 0 && (
        <ViewMenu icon={null} summary={market.currency} srLabel={m.chooseCurrency} items={currencies} prefix={prefix} currentSlug={market.slug} list={list} />
      )}
    </div>
  );
}

export function MarketChoice({ store, market, m, className = "hidden md:block" }: Props & { m: Messages; className?: string }) {
  if (store.markets.length < 2) return null;
  return (
    <details className={`group relative ${className}`}>
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
              aria-current={other.code === market.code ? "page" : undefined}
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
export const HEADER_BACKGROUND: Record<HeaderBackground, string> = {
  page: "bg-background/95 backdrop-blur",
  surface: "bg-surface",
  accent: "bg-accent text-accent-foreground",
  inverse: "bg-foreground text-background",
};

/** The online shop's tools in the standard header: search, My account, wishlists and the cart (none in a website, D178 step 5). */
function ShopTools({ store, market }: Props) {
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  return (
    <>
      <Link href={`${base}/search`} className="flex size-11 items-center justify-center rounded-full hover:bg-current/5">
        <Icon name="search" />
        <span className="sr-only">{m.search.title}</span>
      </Link>
      <Link
        href={`${base}/account`}
        className="hidden size-11 items-center justify-center rounded-full hover:bg-current/5 kzb-md-flex"
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
    </>
  );
}

export function StoreHeader({ store, market, notice }: Props & { notice: string | null }) {
  const m = t(market.lang);
  const header = storeMenu(store, store.headerMenuId);
  const layout = store.theme.settings.layout;
  // The logo on the left with the menu beside it, or in the middle with the menu below (D60).
  const centred = layout.headerAlign === "center";

  const menuButton = (
    <button
      type="button"
      data-open-menu
      aria-haspopup="dialog"
      aria-controls="store-menu"
      className="-ml-2 flex size-11 items-center justify-center rounded-full kzb-md-hidden"
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
          layout="row"
          justify={centred ? "justify-center" : ""}
          linkClassName="flex min-h-11 items-center rounded-button px-3 text-sm font-medium hover:bg-current/5"
        />
      </nav>
    );
  // A website (D178 step 5: the online shop off) has no search of products, My account, wishlists or cart in its header.
  const selling = featureOn(store, "shop");
  const tools = (
    <div className={`flex items-center gap-1 ${centred ? "justify-end" : "ml-auto"}`}>
      <MarketChoice store={store} market={market} m={m} />
      <LocaleChoice store={store} market={market} m={m} className="hidden kzb-md-flex" />
      {store.theme.settings.visitorSwitch && <StoreColorSwitch store={store} labels={m.colorMode} />}
      {selling && <ShopTools store={store} market={market} />}
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
  const header = storeMenu(store, store.headerMenuId);
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
            layout="drawer"
            linkClassName="flex min-h-12 items-center border-b border-border text-lg"
          />
        </nav>
      )}
      {/* A website (D178 step 5: the online shop off) has no My account or cart to link to. */}
      {featureOn(store, "shop") && (
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
      )}
      <LocaleChoice store={store} market={market} m={m} list className="mt-auto" />
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
                  aria-current={other.code === market.code ? "page" : undefined}
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
 * The way to the withdrawal function (D153, `docs/returns.md`): the EU asks it to be always accessible, so the standard footer
 * holds it, a footer built in the page builder holds it as a component, and one without it gets this under it.
 */
export function WithdrawalLink({ store, market }: Props) {
  return (
    <Link href={marketPath(store.slug, market.slug, "/withdraw")} className="w-fit text-muted underline">
      {t(market.lang).returns.footerLink}
    </Link>
  );
}

/**
 * The standard link, under a footer that has none of its own: a store's footer from before the withdrawal function, or one
 * where the component is hidden on phones or only in a modal.
 */
export function WithdrawalStrip({ store, market }: Props) {
  return (
    <div className="border-t border-border bg-surface/40 px-4 py-3 text-sm">
      <div className="mx-auto max-w-(--content-width)">
        <WithdrawalLink store={store} market={market} />
      </div>
    </div>
  );
}

/**
 * Who sells (required on every page of a web shop, by e-commerce and
 * consumer law), the footer menu and the countries.
 */
export function StoreFooter({
  store,
  market,
  legal: legalPages = [],
  withdrawal = true,
}: Props & {
  legal?: LegalLink[];
  /** Whether the withdrawal link is drawn: always while the online shop is on, else while after-sale is open (D178 step 5). */
  withdrawal?: boolean;
}) {
  const m = t(market.lang);
  const footer = storeMenu(store, store.footerMenuId);
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
          {/* The withdrawal function, always reachable (D153); in a website (D178 step 5) while an order can still be withdrawn from or returned. */}
          {withdrawal && <WithdrawalLink store={store} market={market} />}
          {/* The store's terms, privacy statement and the like, once the owner has published them (wave 1, 1e). */}
          {legalPages.length > 0 && (
            <nav aria-label={m.terms.legalNav}>
              <ul className="flex flex-col gap-1">
                {legalPages.map((page) => (
                  <li key={page.role}>
                    <Link href={page.href} className="inline-flex min-h-10 items-center text-muted underline">
                      {page.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
        {footer.length > 0 && (
          <nav aria-label={m.footerMenu}>
            <MenuLinks
              items={footer}
              store={store}
              market={market}
              layout="column"
              linkClassName="inline-flex min-h-10 items-center hover:underline"
            />
          </nav>
        )}
        <LocaleChoice store={store} market={market} m={m} list />
        {store.markets.length > 1 && (
          <nav aria-label={m.chooseMarket}>
            <ul className="flex flex-col gap-1">
              {store.markets.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={marketPath(store.slug, other.slug)}
                    hrefLang={other.lang}
                    lang={other.lang}
                    aria-current={other.code === market.code ? "page" : undefined}
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
        {/* A website (D178 step 5: the online shop off) has no My account or cart to link to. */}
        {featureOn(store, "shop") && (
          <>
            <Link href={`${base}/account`} className={item}>
              <Icon name="user" />
              {m.account.title}
            </Link>
            <Suspense fallback={<CartLinkShell storeSlug={store.slug} market={market} variant="bar" />}>
              <CartLink storeId={store.id} storeSlug={store.slug} market={market} variant="bar" />
            </Suspense>
          </>
        )}
      </nav>
    </HidingBottomBar>
  );
}
