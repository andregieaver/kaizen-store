"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { WORK_ROOT, workBase } from "@/lib/work-paths";

/**
 * Work's sub-navigation (D123): the combined view's sections across the
 * owner's stores, or, on one store's own screens (`/admin/account/work/s/{store}/…`),
 * that store's sections with a way back to the combined view, the store's name
 * and a switch to another store's Work. Links are built with `WORK_ROOT` and
 * `workBase()`, never by hand.
 */

/** A store the person belongs to; the switch offers those with Work on. */
export type WorkNavStore = { slug: string; name: string; workOn: boolean };

export const WORK_SECTIONS = [
  { path: "", label: "Overview" },
  { path: "/clients", label: "Clients" },
  { path: "/time", label: "Time" },
  { path: "/invoices", label: "Invoices" },
  { path: "/reports", label: "Reports" },
  { path: "/settings", label: "Settings" },
] as const;

/** The store a Work address is in and what follows it, or null for the combined view. */
export function storeOfWorkPath(pathname: string): { slug: string; rest: string } | null {
  const match = /^\/admin\/account\/work\/s\/([^/]+)(\/.*)?$/.exec(pathname);
  return match ? { slug: decodeURIComponent(match[1]), rest: match[2] ?? "" } : null;
}

/** The section of the combined view or a store's Work an address is in, by its path after the base ("" is the overview). */
export function sectionOf(rest: string): string {
  const first = /^\/[^/?#]+/.exec(rest)?.[0] ?? "";
  return WORK_SECTIONS.some((section) => section.path === first) ? first : "";
}

const linkClass =
  "flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm text-muted hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground";

export function WorkNav({ stores }: { stores: WorkNavStore[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const inStore = storeOfWorkPath(pathname);
  const base = inStore ? workBase(inStore.slug) : WORK_ROOT;
  const rest = inStore ? inStore.rest : pathname.slice(WORK_ROOT.length);
  const current = sectionOf(rest);
  const store = inStore ? stores.find((item) => item.slug === inStore.slug) : null;
  const choices = stores.filter((item) => item.workOn || item.slug === inStore?.slug);

  return (
    <div className="mb-4 flex flex-col gap-2">
      {inStore && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Link href={WORK_ROOT} className="underline">
            All stores&apos; Work
          </Link>
          <span aria-hidden="true" className="text-muted">
            /
          </span>
          <span className="font-medium">{store?.name ?? inStore.slug}</span>
          {choices.length > 1 && (
            <label className="ml-auto flex items-center gap-2 text-muted">
              <span>Store</span>
              <select
                value={inStore.slug}
                onChange={(event) => router.push(`${workBase(event.target.value)}${current}`)}
                className="min-h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                {choices.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <nav
        aria-label={inStore ? `${store?.name ?? inStore.slug} Work sections` : "Work sections"}
        className="overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="-mb-px flex min-w-max gap-1">
          {WORK_SECTIONS.map((section) => (
            <li key={section.path}>
              <Link
                href={`${base}${section.path}`}
                aria-current={current === section.path ? "page" : undefined}
                className={linkClass}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
