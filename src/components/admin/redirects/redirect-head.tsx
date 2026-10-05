import Link from "next/link";
import type { ReactNode } from "react";

import { REDIRECT_TABS, redirectPaths, type RedirectTab } from "@/lib/redirect-admin";

/**
 * The head of every redirect page (wave 2, D168, `docs/wave-2-redirects.md` 2.2, 2.3): the title, what the page is for and the four tabs (the redirects, the
 * report of pages not found, import and export). Full width like the other admin pages; the admin's tokens only. The active tab is marked with
 * `aria-current`, so it works without a script.
 */
export function RedirectsHead({ slug, active, title, intro, back }: { slug: string; active: RedirectTab; title: string; intro: ReactNode; back?: { href: string; label: string } }) {
  const paths = redirectPaths(slug);
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link href={back.href} className="text-sm text-muted underline underline-offset-2">
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="max-w-3xl text-sm text-muted">{intro}</p>
      </div>
      <nav aria-label="Redirects" className="flex flex-wrap gap-1 border-b border-border text-sm">
        {REDIRECT_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={paths[tab.id]}
            aria-current={active === tab.id ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
