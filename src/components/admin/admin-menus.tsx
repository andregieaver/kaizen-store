"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The two menus every admin header has (D107): the level switcher on the
 * left, which reaches every place the person may go, and the account menu on
 * the right. Both close on Escape, on a click outside, and when a link in
 * them is followed (the address changes).
 */

/** A menu that is open for one address only: leaving it closes it, without an effect to do so. */
function useMenu() {
  const pathname = usePathname();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenAt(null);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpenAt(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  return { open, toggle: () => setOpenAt(open ? null : pathname), box, button };
}

export type SwitcherStore = { slug: string; name: string; role: "owner" | "admin"; suspended?: boolean };

const item = "flex min-h-10 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-medium";
const heading = "px-3 pb-1 pt-1 text-xs font-semibold tracking-wide text-muted uppercase";
/** The links of a section sit a step in from its heading, with a rule down their side. */
const indented = "ml-3 flex flex-col gap-0.5 border-l border-border pl-1";

/** A section of the level switcher: a divider above (but the first), a heading, and its links. */
function Section({ id, title, first, children }: { id: string; title: string; first?: boolean; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className={first ? "" : "mt-1 border-t border-border pt-2"}>
      <p id={id} className={heading}>
        {title}
      </p>
      <div className={indented}>{children}</div>
    </div>
  );
}

/** Marks the place you are in, beside the link's text. */
function Here({ on }: { on: boolean }) {
  return on ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="ml-auto size-4 shrink-0 text-foreground" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 12l5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : null;
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Where you are, and a way to any other level: the control center (owners),
 * each store, the platform (Kaizen's team), and the account. The current
 * level and store are marked.
 */
export function AdminSwitcher({
  level,
  label,
  stores,
  currentSlug,
  owner,
  platform,
}: {
  level: "platform" | "control" | "store" | "hosting";
  /** The current place's name: the store's, or the level's. */
  label: string;
  stores: SwitcherStore[];
  currentSlug?: string;
  /** Whether the person owns a store, so has a control center. */
  owner: boolean;
  /** Kaizen's team: requests waiting. Null for everyone else. */
  platform: { waiting: number } | null;
}) {
  const { open, toggle, box, button } = useMenu();
  const shown = stores.slice(0, 12);
  return (
    <div ref={box} className="relative min-w-0">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-10 max-w-full items-center gap-2 rounded-md px-2 hover:bg-surface"
      >
        <span className="hidden font-semibold sm:inline">Kaizen</span>
        <span aria-hidden="true" className="hidden text-muted sm:inline">
          /
        </span>
        <span className="truncate font-medium">{label}</span>
        <Chevron />
      </button>
      {open && (
        <div role="menu" aria-label="Go to" className="absolute left-0 top-full z-50 mt-1 flex max-h-[80dvh] w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-xl">
          {owner && (
            <Link role="menuitem" href="/admin" aria-current={level === "control" ? "page" : undefined} className={`${item} font-medium`}>
              Control center
              <span className="ml-auto text-xs font-normal text-muted">{level === "control" ? "" : "all your stores"}</span>
              <Here on={level === "control"} />
            </Link>
          )}
          {shown.length > 0 && (
            <Section id="switch-stores" title="Stores" first={!owner}>
              {shown.map((s) => {
                const here = level === "store" && s.slug === currentSlug;
                return (
                  <Link key={s.slug} role="menuitem" href={`/admin/${s.slug}`} aria-current={here ? "page" : undefined} className={item}>
                    <span className="truncate">{s.name}</span>
                    {s.suspended && <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">Suspended</span>}
                    {s.role === "admin" && <span className="ml-auto text-xs text-muted">Staff</span>}
                    {here && !(s.role === "admin") && <Here on />}
                  </Link>
                );
              })}
              {stores.length > shown.length && (
                <Link role="menuitem" href="/admin/stores" className={`${item} text-muted`}>
                  All {stores.length} stores
                </Link>
              )}
            </Section>
          )}
          {platform && (
            <Section id="switch-kaizen" title="Kaizen" first={!owner && shown.length === 0}>
              <Link role="menuitem" href="/admin/platform" aria-current={level === "platform" ? "page" : undefined} className={item}>
                Platform
                {platform.waiting > 0 && <span className="ml-auto rounded-full bg-foreground px-1.5 py-0.5 text-xs leading-none text-background">{platform.waiting} waiting</span>}
                {platform.waiting === 0 && <Here on={level === "platform"} />}
              </Link>
            </Section>
          )}
          <Section id="switch-you" title="You" first={!owner && shown.length === 0 && !platform}>
            <Link role="menuitem" href="/admin/account" className={item}>
              Your account
            </Link>
            {owner && (
              <>
                <Link role="menuitem" href="/admin/account/billing" className={item}>
                  Billing
                </Link>
                <Link role="menuitem" href="/admin/account/usage" className={item}>
                  AI usage
                </Link>
              </>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

/** The account's menu: who is signed in, their account, the colours, and signing out. The rows come from the server. */
export function AccountMenu({ avatar, name, email, children }: { avatar: ReactNode; name: string | null; email: string; children: ReactNode }) {
  const { open, toggle, box, button } = useMenu();
  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu, ${email}`}
        className="flex size-10 items-center justify-center rounded-full hover:bg-surface"
      >
        {avatar}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-border bg-background p-2 shadow-xl">
          <div className="px-3 py-2">
            {name && <p className="truncate text-sm font-medium">{name}</p>}
            <p className="truncate text-sm text-muted">{email}</p>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

/** A row of the account menu that is a link. */
export function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link role="menuitem" href={href} className={item}>
      {children}
    </Link>
  );
}

/** A row of the account menu holding a control (the colours' switch, signing out). */
export function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-2 rounded-md px-3 text-sm">
      <span>{label}</span>
      {children}
    </div>
  );
}
