import Link from "next/link";

import { PLATFORM_BASE, type SectionItem } from "@/lib/platform-nav";

/** A section's first page (D144): a card for each page in its sidebar, with a line on what it does. */
export function SectionHub({ title, intro, items }: { title: string; intro: string; items: SectionItem[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="max-w-2xl text-sm text-muted">{intro}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.path}>
            <Link href={`${PLATFORM_BASE}${item.path}`} className="flex h-full flex-col gap-1 rounded-lg border border-border bg-background p-4 hover:bg-surface">
              <span className="font-medium">{item.label}</span>
              <span className="text-sm text-muted">{item.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
