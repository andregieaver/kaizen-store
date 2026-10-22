import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";

import { CARD_CLASS } from "./card";

/**
 * The `focus` layout (docs/admin-style.md 6.3) for the pages a person sees before they are let in: sign-in, the two-step pages, a
 * forgotten password and the OAuth consent. Nothing of a level is drawn (no rail, no tabs, no account): a plain top bar with Kaizen's
 * mark, and one card on the canvas holding the page's title, a sentence and the form. `narrow` (a sign-in form) or `wide` (a set-up
 * with a QR code and recovery codes).
 */

const WIDTH = { narrow: "max-w-[440px]", wide: "max-w-[560px]" } as const;

export type FocusFrameProps = {
  /** The page's title, its `h1`. A page whose title depends on what it finds draws `FocusHeading` inside instead. */
  title?: ReactNode;
  description?: ReactNode;
  /** A link above the title, back to where this page was reached from ("Back to sign in"). */
  back?: { href: string; label: string };
  /** On the top bar's right: a link out ("Ask for a store"). */
  aside?: ReactNode;
  width?: keyof typeof WIDTH;
  /** The language the page is written in (D312 A1), on the frame: the admin's root `<html lang>` is the account's, and nobody is signed in yet. */
  lang?: AdminLang;
  children?: ReactNode;
};

export function FocusFrame({ title, description, back, aside, width = "narrow", lang, children }: FocusFrameProps) {
  return (
    <div data-admin-layout="focus" lang={lang ? ADMIN_LANG_FACTS[lang].tag : undefined} className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3 text-body-strong text-ink">
          <span aria-hidden className="flex size-9 items-center justify-center rounded-tile bg-brand text-title text-brand-ink">
            K
          </span>
          Kaizena Flow
        </Link>
        {aside && <div className="text-body text-ink-2">{aside}</div>}
      </header>
      <main className="flex flex-1 justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className={`w-full ${WIDTH[width]}`}>
          {back && (
            <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-body text-ink-2 hover:text-ink">
              <ChevronLeft aria-hidden className="size-4" />
              {back.label}
            </Link>
          )}
          <div className={`flex flex-col gap-6 p-6 sm:p-8 ${CARD_CLASS}`}>
            {title && <FocusHeading title={title} description={description} />}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/** The card's title and its sentence: the page's `h1`. */
export function FocusHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-display text-ink">{title}</h1>
      {description && <div className="text-body text-ink-2">{description}</div>}
    </div>
  );
}
