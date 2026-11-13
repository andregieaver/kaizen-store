import Link from "next/link";

import type { ChipKind, SupportChip } from "@/lib/support-visitor";

/** Whether an address is on the website the frame is on, or its `www.` twin. */
function sameSite(href: string, host: string): boolean {
  try {
    const at = new URL(href).hostname.toLowerCase();
    return at === host || at === `www.${host}` || `www.${at}` === host;
  } catch {
    return false;
  }
}

/** The chips' words by kind (D216, 2.1); `{label}` stands for the number the chip is about. */
export type ChipLabels = Record<ChipKind, string>;

/**
 * The links the AI's tools gave (D216, 2.1, step 9), as chips under its answer, in the site's words: a page of the site opens in place,
 * anything else (a carrier's tracking page) in a new tab. The addresses were made by code and checked on the server; one that is
 * neither a path on the site nor a web address is left out here too.
 */
export function Chips({
  chips,
  labels,
  onOpen,
  top,
}: {
  chips: SupportChip[];
  labels: ChipLabels;
  onOpen: () => void;
  /** In a widget on the owner's own website (D583), the page the frame is on: a link to it opens there, in the visitor's own tab. */
  top?: { host: string };
}) {
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
              <a
                href={chip.href}
                {...(top && sameSite(chip.href, top.host) ? { target: "_top" } : { target: "_blank", rel: "noopener noreferrer" })}
                className={className}
              >
                {words} {top && sameSite(chip.href, top.host) ? "→" : "↗"}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
