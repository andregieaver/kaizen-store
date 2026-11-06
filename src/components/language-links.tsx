"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

import { languageCookie } from "@/lib/language-rule";

import { Icon } from "./icons";

/** One language in the switcher (D479): where its link goes and how it is shown. */
export type LanguageLink = {
  key: string;
  /** The language, two letters, for `lang` and `hreflang`. */
  lang: string;
  /** Its name in itself: "Norsk bokmål", "English". */
  name: string;
  /** Its short code: `NB`, `EN`. */
  code: string;
  /** Its flag's address (`/flags/no.svg`), or null where none is kept. */
  flag: string | null;
  /** Where the link goes as drawn: the page in that language, or (`samePage`) that language's front page. */
  href: string;
  current: boolean;
};

/**
 * The language switcher (D479): every language as a link, in a list and in a drop-down list, both drawn; the part stylesheet shows the one
 * each screen size asks for, side by side or one under another, and each language's name, short code or flag as it asks
 * (`languageSwitchStyle()`, `className`). Each link is a target of 24 px at least (WCAG 2.5.8). Kaizena Flow's site draws each link to the
 * page in that language (D312); a store's links are to each language's front page and go to the page the visitor is on when chosen
 * (`samePage`, as `ViewMenu`), so pages stay prerendered. Choosing a language in a store remembers it for its front door (`remember`).
 */
export function LanguageLinks({
  label,
  items,
  className = "",
  samePage,
  remember,
}: {
  label: string;
  items: LanguageLink[];
  className?: string;
  /** A store's: the current view's front page as a path before the rest of an address (`marketPath()`), to keep the page when chosen. */
  samePage?: { here: string };
  /** The store's id: a language chosen is kept in its cookie (`kaizen_lang_{storeId}`). */
  remember?: string;
}) {
  const router = useRouter();
  const current = items.find((item) => item.current) ?? items[0];
  if (!current) return null;

  const choose = (item: LanguageLink) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const cookie = remember ? languageCookie(remember, item.lang, window.location.protocol === "https:") : null;
    if (cookie) document.cookie = cookie;
    event.currentTarget.closest("details")?.removeAttribute("open");
    if (!samePage) return;
    event.preventDefault();
    // The page the visitor is on, in the language chosen, with what is asked of it kept.
    const path = window.location.pathname;
    const here = samePage.here;
    const rest = here === "" ? (path === "/" ? "" : path) : path === here || path.startsWith(`${here}/`) ? path.slice(here.length) : "";
    const to = `${item.href}${rest}${window.location.search}${window.location.hash}` || "/";
    // A language on a domain of its own (D313) is another site: a full page load.
    if (/^https?:\/\//.test(item.href)) window.location.assign(to);
    else router.push(to);
  };

  const flag = (item: LanguageLink) =>
    item.flag ? (
      // eslint-disable-next-line @next/next/no-img-element -- a flag of a few hundred bytes from the site's own files, drawn at 20 by 15 pixels
      <img data-ls-flag="" src={item.flag} alt="" width={20} height={15} decoding="async" className="h-[15px] w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-current/15" />
    ) : null;
  // What the list and the menu's button show of a language: the stylesheet keeps the name, the code or neither at each size.
  const face = (item: LanguageLink) => (
    <>
      {flag(item)}
      <span data-ls-name="">{item.name}</span>
      {/* Read where it is shown, so a link whose visible words are `NB` is named with them too (WCAG 2.5.3); not shown, it is not read. */}
      <span data-ls-code="">{item.code}</span>
    </>
  );
  const link = (item: LanguageLink, classes: string, body: React.ReactNode) => (
    <a
      href={item.href || "/"}
      hrefLang={item.lang}
      lang={item.lang}
      aria-current={item.current ? "true" : undefined}
      onClick={choose(item)}
      className={classes}
    >
      {body}
    </a>
  );

  return (
    <nav aria-label={label} data-language-switch="" className={className}>
      <ul data-ls-list="" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {items.map((item) => (
          <li key={item.key}>
            {link(item, "inline-flex min-h-6 min-w-6 items-center gap-1.5 hover:underline aria-[current=true]:font-semibold", face(item))}
          </li>
        ))}
      </ul>
      <details data-ls-menu="" className="group relative">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-button px-3 text-sm hover:bg-current/5 [&::-webkit-details-marker]:hidden">
          <span lang={current.lang} className="inline-flex items-center gap-1.5">
            {face(current)}
          </span>
          <Icon name="chevron" className="size-4 transition-transform group-open:rotate-180" />
          <span className="sr-only">· {label}</span>
        </summary>
        <ul className="absolute right-0 z-10 mt-2 min-w-44 rounded-lg border border-border bg-background p-1 text-foreground shadow-lg">
          {items.map((item) => (
            <li key={item.key}>
              {link(
                item,
                "flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface aria-[current=true]:font-semibold",
                <>
                  {flag(item)}
                  {item.name}
                </>,
              )}
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
