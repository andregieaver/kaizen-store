import Link from "next/link";

import { browserText } from "@/lib/browser-text";

import { Icon } from "./icons";

/**
 * The cart link, with how many items it holds: a bag in the header, a labelled icon in the phone's bottom bar. A plain component, so
 * the browser's `CartLink` (`cart-link-live.tsx`) draws it with the count it asked for (bloat review step 2.4); its words are the
 * browser's (D212). `href` is the cart's address as the server writes it (`marketPath()`, which knows the store's address shape).
 */
export function CartLinkShell({
  href,
  lang,
  variant = "header",
  count = 0,
}: {
  href: string;
  lang: string;
  variant?: "header" | "bar";
  count?: number;
}) {
  const m = browserText(lang);
  const badge = count > 0 && (
    <span
      aria-hidden="true"
      className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold text-accent-foreground"
    >
      {count}
    </span>
  );
  const name = count > 0 ? m.cartCount(count) : m.cart;
  if (variant === "bar") {
    return (
      <Link href={href} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs">
        <span className="relative">
          <Icon name="bag" />
          {badge}
        </span>
        <span aria-hidden="true">{m.cart}</span>
        <span className="sr-only">{name}</span>
      </Link>
    );
  }
  const inner = (
    <>
      <Icon name="bag" />
      {badge}
      <span className="sr-only">{name}</span>
    </>
  );
  // Drawn twice, one shown at a time: a router link under 768 px (the intercepted drawer) and a plain anchor from 768 px, which is never in view
  // on a phone and so never fetched ahead, and is not in the accessibility tree while hidden (D64, bloat review step 2.2).
  return (
    <>
      <Link href={href} className="relative flex size-11 items-center justify-center rounded-full hover:bg-current/5 md:hidden">
        {inner}
      </Link>
      <a href={href} className="relative hidden size-11 items-center justify-center rounded-full hover:bg-current/5 md:flex">
        {inner}
      </a>
    </>
  );
}
