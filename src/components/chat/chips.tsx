import Link from "next/link";

import type { ChipKind, SupportChip } from "@/lib/support-visitor";

/** The chips' words by kind (D216, 2.1); `{label}` stands for the number the chip is about. */
export type ChipLabels = Record<ChipKind, string>;

/**
 * The links the AI's tools gave (D216, 2.1, step 9), as chips under its answer, in the site's words: a page of the site opens in place,
 * anything else (a carrier's tracking page) in a new tab. The addresses were made by code and checked on the server; one that is
 * neither a path on the site nor a web address is left out here too.
 */
export function Chips({ chips, labels, onOpen }: { chips: SupportChip[]; labels: ChipLabels; onOpen: () => void }) {
  const shown = chips.filter((chip) => labels[chip.kind] && (/^\/(?![/\\])\S*$/.test(chip.href) || /^https?:\/\/\S+$/i.test(chip.href)));
  if (shown.length === 0) return null;
  const className = "rounded-button border border-border px-3 py-1 text-sm hover:bg-surface";
  return (
    <ul className="ml-9 flex flex-wrap gap-2">
      {shown.map((chip) => {
        const words = labels[chip.kind].replace("{label}", chip.label).trim();
        return (
          <li key={chip.href}>
            {chip.href.startsWith("/") ? (
              <Link href={chip.href} onClick={onOpen} className={className}>
                {words} →
              </Link>
            ) : (
              <a href={chip.href} target="_blank" rel="noopener noreferrer" className={className}>
                {words} ↗
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
