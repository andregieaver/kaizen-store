import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { motionNeeds } from "@/lib/motion-attrs";
import type { PageBlock, PageContent, SiteBlock } from "@/lib/page-content";
import { flowRows } from "@/lib/page-modal";
import { localizePage } from "@/lib/page-translation";
import { partFeatureOn } from "@/lib/part-features";
import { marketPath } from "@/lib/paths";
import { siteBlocks } from "@/lib/site-layout";
import type { GridPlace } from "@/server/content-grid";
import { bindStoreFields } from "@/server/field-binding";
import type { PlatformChrome } from "@/server/platform-navigation";
import type { SiteLayout } from "@/server/site-layouts";
import type { Store } from "@/server/stores";

import { BuyerSwitch } from "./buyer";
import { StoreColorSwitch } from "./store-color-switch";
import { CartLink, CartLinkShell } from "./cart-link";
import { Icon } from "./icons";
import { PageRowView, rowShows } from "./page-article";
import { MotionSupport } from "./motion-support";
import { BUILT_IN, Brand as KaizenBrand } from "./platform-layout";
import { HidingHeader } from "./store-chrome";
import { HEADER_BACKGROUND, Brand as StoreBrand, LocaleChoice, MarketChoice, WithdrawalLink, hasViewChoices } from "./store-layout";
import { WishlistCount } from "./wishlist-heart";

/**
 * The site's header and footer built in the page builder (D80): rows of
 * components, among them the site's own parts (logo, menus, search,
 * account, wishlist, cart, countries, buyer switch, sign-up, business
 * details, cookies link), drawn here with the store and its country or
 * with Kaizen's settings. A part with nothing to show draws nothing.
 */

/** Where a header or footer is drawn: a store's, in one of its countries, or Kaizen's. */
export type SiteContext =
  | { kind: "store"; store: Store; market: Market; place: "header" | "footer" }
  | { kind: "kaizen"; chrome: PlatformChrome; place: "header" | "footer" };

const ICON_LINK = "flex size-11 items-center justify-center rounded-full hover:bg-current/5";
const COLUMN_LINK = "inline-flex min-h-10 items-center hover:underline";

/** Whether a part has anything to show here: its owner's, with links or countries to show. */
export function sitePartShows(block: SiteBlock, ctx: SiteContext): boolean {
  if (ctx.kind === "kaizen") {
    if (["search", "wishlist", "cart", "markets", "buyerSwitch", "colorMode"].includes(block.part)) return false;
    return true;
  }
  const { store } = ctx;
  // A part of a store feature that is off draws nothing (D178): the business or private switch with Sell to businesses off.
  if (!partFeatureOn(block, store)) return false;
  switch (block.part) {
    case "signUp":
      return false;
    case "markets":
      // Countries, languages or currencies (D109): whichever have more than one choice here (D178: with one country, the languages and currencies still).
      return store.markets.length > 1 || hasViewChoices(store, ctx.market);
    case "buyerSwitch":
      return store.audience === "both";
    case "colorMode":
      // Only while the store lets visitors choose (D99).
      return store.theme.settings.visitorSwitch;
    default:
      return true;
  }
}

/** One site part, drawn with the site; hiding it on phones is its wrapper's (`blockBox`). */
export function SitePartView({ block, ctx }: { block: SiteBlock; ctx: SiteContext }): ReactNode {
  if (!sitePartShows(block, ctx)) return null;
  return ctx.kind === "store" ? <StorePart block={block} ctx={ctx} /> : <KaizenPart block={block} ctx={ctx} />;
}

function MenuButton({ label }: { label: string }) {
  // The slide-out menu opens on any `data-open-menu` button.
  return (
    <button
      type="button"
      data-open-menu
      aria-haspopup="dialog"
      aria-controls="store-menu"
      className="flex size-11 items-center justify-center rounded-full md:hidden"
    >
      <Icon name="menu" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

const logoHeight = (block: SiteBlock) => block.height;

function StorePart({ block, ctx }: { block: SiteBlock; ctx: Extract<SiteContext, { kind: "store" }> }) {
  const { store, market, place } = ctx;
  const m = t(market.lang);
  const base = marketPath(store.slug, market.slug);
  const column = block.direction === "column";
  switch (block.part) {
    case "logo":
      return <StoreBrand store={store} market={market} size={place} height={logoHeight(block)} />;
    case "menuButton":
      return <MenuButton label={m.openMenu} />;
    case "search":
      return (
        <Link href={`${base}/search`} className={ICON_LINK}>
          <Icon name="search" />
          <span className="sr-only">{m.search.title}</span>
        </Link>
      );
    case "account":
      return (
        <Link href={`${base}/account`} className={ICON_LINK}>
          <Icon name="user" />
          <span className="sr-only">{m.account.title}</span>
        </Link>
      );
    case "wishlist":
      return (
        <Link href={`${base}/wishlist`} className={`relative ${ICON_LINK}`}>
          <Icon name="heart" />
          <WishlistCount base={base} />
          <span className="sr-only">{m.wishlist.title}</span>
        </Link>
      );
    case "cart":
      return (
        <Suspense fallback={<CartLinkShell storeSlug={store.slug} market={market} />}>
          <CartLink storeId={store.id} storeSlug={store.slug} market={market} />
        </Suspense>
      );
    case "markets":
      // With one country offered (D178) the list is of the languages and currencies, where there is a choice of them.
      if (block.display === "list" && store.markets.length < 2) return <LocaleChoice store={store} market={market} m={m} list />;
      return block.display === "list" ? (
        <nav aria-label={m.chooseMarket}>
          <ul className={column ? "flex flex-col gap-1" : "flex flex-wrap gap-x-4 gap-y-1"}>
            {store.markets.map((other) => (
              <li key={other.slug}>
                <Link
                  href={marketPath(store.slug, other.slug)}
                  hrefLang={other.lang}
                  lang={other.lang}
                  aria-current={other.slug === market.slug ? "page" : undefined}
                  className={`${COLUMN_LINK} aria-[current=page]:font-semibold`}
                >
                  {other.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <div className="flex flex-wrap items-center">
          <MarketChoice store={store} market={market} m={m} className="" />
          <LocaleChoice store={store} market={market} m={m} />
        </div>
      );
    case "buyerSwitch":
      return <BuyerSwitch storeId={store.id} labels={m.buyer} />;
    case "colorMode":
      return <StoreColorSwitch store={store} labels={m.colorMode} />;
    case "business": {
      const details = store.details;
      const legal = [details.legalName ?? store.name, details.organisationNumber && `Org. ${details.organisationNumber}`]
        .filter(Boolean)
        .join(" · ");
      return <Business legal={legal} address={details.postalAddress} email={details.contactEmail} />;
    }
    case "cookies":
      // What the store stores in the browser, and the choice about it (D58).
      return (
        <Link href={marketPath(store.slug, market.slug, "/cookies")} className="w-fit text-muted underline">
          {m.cookies}
        </Link>
      );
    case "withdrawal":
      // The withdrawal function, always reachable (D153).
      return <WithdrawalLink store={store} market={market} />;
    case "signUp":
      return null;
  }
}

function KaizenPart({ block, ctx }: { block: SiteBlock; ctx: Extract<SiteContext, { kind: "kaizen" }> }) {
  const { chrome, place } = ctx;
  const m = t("en");
  switch (block.part) {
    case "logo":
      return <KaizenBrand chrome={chrome} size={place} height={logoHeight(block)} />;
    case "menuButton":
      return <MenuButton label={m.openMenu} />;
    case "account":
      return (
        <Link href="/admin" className={ICON_LINK}>
          <Icon name="user" />
          <span className="sr-only">{BUILT_IN.signIn}</span>
        </Link>
      );
    case "signUp":
      return (
        <Link href="/sign-up" className="flex min-h-10 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background">
          {BUILT_IN.signUp}
        </Link>
      );
    case "business": {
      const b = chrome.business;
      const legal = [b.legalName || "Kaizen", b.organisationNumber && `Org. ${b.organisationNumber}`].filter(Boolean).join(" · ");
      return <Business legal={legal} address={b.postalAddress} email={b.contactEmail} />;
    }
    case "cookies":
      return (
        <Link href="/cookies" className="w-fit text-muted underline">
          {m.cookies}
        </Link>
      );
    default:
      return null;
  }
}

/** Who sells or runs the site (required on every page of a web shop or service). */
function Business({ legal, address, email }: { legal: string; address: string | null | undefined; email: string | null | undefined }) {
  return (
    <address className="flex flex-col gap-1 not-italic text-muted">
      <span>{legal}</span>
      {address && <span>{address.replace(/\s*\n\s*/g, ", ")}</span>}
      {email && (
        <a href={`mailto:${email}`} className="w-fit underline">
          {email}
        </a>
      )}
    </address>
  );
}

/** A header's or footer's rows, with its site parts drawn for the site. */
export function SiteRows({ content, ctx, place }: { content: PageContent; ctx: SiteContext; place: GridPlace }) {
  // A part with nothing to show leaves no space behind (null), as a product's does (D79).
  const render = (block: PageBlock) =>
    block.type === "site" ? (sitePartShows(block, ctx) ? <SitePartView block={block} ctx={ctx} /> : null) : undefined;
  const rows = content.rows.filter(rowShows);
  // Motion (D128): a header's or footer's first row plays its entrances by CSS at once; the runtime only if something needs it.
  const first = flowRows(rows)[0];
  return (
    <>
      {rows.map((row) => (
        <PageRowView key={row.id} row={row} place={place} renderBlock={render} first={row === first} />
      ))}
      <MotionSupport needs={motionNeeds(rows)} />
    </>
  );
}

/** The notice over a store's header (preview, demo or test payments), which every header keeps. */
function Notice({ text }: { text: string | null }) {
  return text ? <p className="bg-foreground px-4 py-2 text-center text-sm text-background">{text}</p> : null;
}

/**
 * A store's own header (D80), in its country's language: the notice, then
 * its rows on the theme's header background, sliding away as the standard
 * header does. A store selling to both kinds of buyer keeps the switch over
 * it unless the header has its own.
 */
export async function StoreSiteHeader({ store, market, notice, layout }: { store: Store; market: Market; notice: string | null; layout: SiteLayout }) {
  const m = t(market.lang);
  // Blocks taking their content from the store's own custom fields (D120) show it; nothing is read when there are none.
  const content = await bindStoreFields(localizePage(layout.content, market.locale), store, market);
  const background = HEADER_BACKGROUND[store.theme.settings.layout.headerBackground];
  const ownSwitch = siteBlocks(content).some((block) => block.part === "buyerSwitch");
  return (
    <HidingHeader overlay={content.overlay && { textColor: content.overlay.textColor }}>
      <Notice text={notice} />
      {store.audience === "both" && !ownSwitch && (
        <div className={`border-b border-border ${background}`}>
          <div className="mx-auto flex max-w-(--content-width) justify-end px-4 py-1">
            <BuyerSwitch storeId={store.id} labels={m.buyer} />
          </div>
        </div>
      )}
      <header className={`site-header border-b border-border ${background}`}>
        <SiteRows
          content={content}
          ctx={{ kind: "store", store, market, place: "header" }}
          place={{ pageId: layout.id, owner: store.id, market: market.slug }}
        />
      </header>
    </HidingHeader>
  );
}

/** A store's own footer (D80), in its country's language. */
export async function StoreSiteFooter({ store, market, layout }: { store: Store; market: Market; layout: SiteLayout }) {
  const content = await bindStoreFields(localizePage(layout.content, market.locale), store, market);
  return (
    <footer className="site-footer mt-auto border-t border-border bg-surface/40 text-sm">
      <SiteRows
        content={content}
        ctx={{ kind: "store", store, market, place: "footer" }}
        place={{ pageId: layout.id, owner: store.id, market: market.slug }}
      />
    </footer>
  );
}

/** Kaizen's own header (D80). */
export function KaizenSiteHeader({ chrome, layout }: { chrome: PlatformChrome; layout: SiteLayout }) {
  const overlay = layout.content.overlay;
  return (
    <HidingHeader overlay={overlay && { textColor: overlay.textColor }}>
      <header className="site-header border-b border-border bg-background/95 backdrop-blur">
        <SiteRows content={layout.content} ctx={{ kind: "kaizen", chrome, place: "header" }} place={{ pageId: layout.id, owner: null }} />
      </header>
    </HidingHeader>
  );
}

/** Kaizen's own footer (D80). */
export function KaizenSiteFooter({ chrome, layout }: { chrome: PlatformChrome; layout: SiteLayout }) {
  return (
    <footer className="site-footer mt-auto border-t border-border bg-surface/40 text-sm">
      <SiteRows content={layout.content} ctx={{ kind: "kaizen", chrome, place: "footer" }} place={{ pageId: layout.id, owner: null }} />
    </footer>
  );
}
