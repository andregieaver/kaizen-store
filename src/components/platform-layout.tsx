import Link from "next/link";

import { t } from "@/lib/i18n";
import { platformMenuLink, type PlatformMenuItem } from "@/lib/navigation";
import type { PlatformChrome } from "@/server/platform-navigation";

import { Icon } from "./icons";
import { HidingBottomBar, HidingHeader, MobileMenu } from "./store-chrome";

/**
 * Kaizen's own header, footer and phone bottom bar (D42), built like a
 * store's (D30) from the logo, menus and business details set under
 * Platform → Header and footer. Cached with those settings and the pages;
 * nothing here is per visitor.
 */

type Props = { chrome: PlatformChrome };

const m = t("en");
const BUILT_IN = { home: "Home", signUp: "Start your store", signIn: "Sign in", blog: "Blog" };

function MenuLinks({
  items,
  chrome,
  className,
  linkClassName,
}: Props & { items: PlatformMenuItem[]; className?: string; linkClassName: string }) {
  const links = items.flatMap((item) => platformMenuLink(item, chrome.pages, BUILT_IN, chrome.terms, chrome.blog) ?? []);
  if (links.length === 0) return null;
  return (
    <ul className={className}>
      {links.map(({ href, text, external }, index) => (
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
      ))}
    </ul>
  );
}

/** The logo, or Kaizen's name without one. */
function Brand({ chrome, size }: Props & { size: "header" | "footer" }) {
  const logo = chrome.navigation.logo;
  return (
    <Link href="/" className="flex min-w-0 items-center">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small logo of known size, not worth resizing
        <img
          src={logo.url}
          alt="Kaizen"
          width={logo.width}
          height={logo.height}
          fetchPriority={size === "header" ? "high" : undefined}
          className={`${size === "header" ? "h-8 md:h-10" : "h-8"} w-auto max-w-44 object-contain object-left md:max-w-56`}
        />
      ) : (
        <span className="truncate text-lg font-semibold">Kaizen</span>
      )}
    </Link>
  );
}

export function PlatformHeader({ chrome }: Props) {
  const header = chrome.navigation.header;
  return (
    <HidingHeader>
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

          <Brand chrome={chrome} size="header" />

          {header.length > 0 && (
            <nav aria-label={m.mainMenu} className="hidden min-w-0 flex-1 md:block">
              <MenuLinks
                items={header}
                chrome={chrome}
                className="flex flex-wrap items-center gap-1"
                linkClassName="flex min-h-11 items-center rounded-full px-3 text-sm font-medium hover:bg-surface"
              />
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Link href="/admin" className="flex size-11 items-center justify-center rounded-full hover:bg-surface">
              <Icon name="user" />
              <span className="sr-only">{BUILT_IN.signIn}</span>
            </Link>
            <Link
              href="/sign-up"
              className="hidden min-h-10 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background sm:flex"
            >
              {BUILT_IN.signUp}
            </Link>
          </div>
        </div>
      </header>
    </HidingHeader>
  );
}

/** The phone's slide-out menu, placed after the page's content (see `MobileMenu`). */
export function PlatformMenu({ chrome }: Props) {
  return (
    <MobileMenu title={<Brand chrome={chrome} size="header" />} labels={{ close: m.closeMenu, menu: m.menu }}>
      {chrome.navigation.header.length > 0 && (
        <nav aria-label={m.mainMenu}>
          <MenuLinks
            items={chrome.navigation.header}
            chrome={chrome}
            className="flex flex-col"
            linkClassName="flex min-h-12 items-center border-b border-border text-lg"
          />
        </nav>
      )}
      <ul className="flex flex-col">
        <li>
          <Link href="/sign-up" className="flex min-h-12 items-center gap-3">
            <Icon name="home" /> {BUILT_IN.signUp}
          </Link>
        </li>
        <li>
          <Link href="/admin" className="flex min-h-12 items-center gap-3">
            <Icon name="user" /> {BUILT_IN.signIn}
          </Link>
        </li>
      </ul>
    </MobileMenu>
  );
}

/** Who runs Kaizen (required on every page of a web service) and the footer menu. */
export function PlatformFooter({ chrome }: Props) {
  const b = chrome.business;
  const legal = [b.legalName || "Kaizen", b.organisationNumber && `Org. ${b.organisationNumber}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <footer className="mt-auto border-t border-border bg-surface/40">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 md:grid-cols-4">
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Brand chrome={chrome} size="footer" />
          <address className="flex flex-col gap-1 not-italic text-muted">
            <span>{legal}</span>
            {b.postalAddress && <span>{b.postalAddress.replace(/\s*\n\s*/g, ", ")}</span>}
            {b.contactEmail && (
              <a href={`mailto:${b.contactEmail}`} className="w-fit underline">
                {b.contactEmail}
              </a>
            )}
          </address>
        </div>
        {chrome.navigation.footer.length > 0 && (
          <nav aria-label={m.footerMenu} className="sm:col-span-2">
            <MenuLinks
              items={chrome.navigation.footer}
              chrome={chrome}
              className="flex flex-col gap-1"
              linkClassName="inline-flex min-h-10 items-center hover:underline"
            />
          </nav>
        )}
      </div>
    </footer>
  );
}

/** Phones: the way round the site, at the thumb. */
export function PlatformBottomBar() {
  const item = "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs";
  return (
    <HidingBottomBar>
      <nav aria-label={m.shortcuts} className="flex">
        <Link href="/" className={item}>
          <Icon name="home" />
          {BUILT_IN.home}
        </Link>
        {/* The slide-out menu opens on any `data-open-menu` button. */}
        <button type="button" data-open-menu aria-haspopup="dialog" aria-label={m.openMenu} className={item}>
          <Icon name="menu" />
          {m.menu}
        </button>
        <Link href="/admin" className={item}>
          <Icon name="user" />
          {BUILT_IN.signIn}
        </Link>
      </nav>
    </HidingBottomBar>
  );
}
