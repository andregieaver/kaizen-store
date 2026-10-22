import Link from "next/link";

/**
 * Small parts the shipping settings' pages share (D237): the row of countries a page is shown for (`?market=`), as links with the current one
 * marked. Presentational.
 */

export function MarketTabs({
  href,
  markets,
  current,
  label = "Countries",
}: {
  href: (code: string) => string;
  markets: readonly { code: string; name: string }[];
  current: string;
  /** The row's name in the admin's language (D312 A8). */
  label?: string;
}) {
  if (markets.length < 2) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {markets.map((m) => (
        <Link
          key={m.code}
          href={href(m.code)}
          aria-current={m.code === current ? "page" : undefined}
          className={`inline-flex h-9 items-center rounded-pill px-4 text-sm ${m.code === current ? "bg-inverse text-inverse-ink" : "border border-edge bg-card text-ink hover:bg-sunken"}`}
        >
          {m.name}
        </Link>
      ))}
    </nav>
  );
}

/** The market a page is for: the one asked for when the store sells there, else the first. */
export function chosenMarket<M extends { code: string }>(markets: readonly M[], asked: unknown): M | null {
  const code = typeof asked === "string" ? asked.toUpperCase() : "";
  return markets.find((m) => m.code === code) ?? markets[0] ?? null;
}
