"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";

import { field, hint, primary, secondary } from "@/components/admin/data/ui";

/** Hands a just-made link to the holder above, which stays mounted while the page refreshes (the builder may not: a live proposal hides it). */
const ShowLink = createContext<((link: string) => void) | null>(null);

/** The setter of the nearest `ExchangeLinkHolder`, or null where there is none. */
export const useShowExchangeLink = () => useContext(ShowLink);

/**
 * Holds the link *Create a link to share* made, shown once (wave 3, D239): it sits at a fixed place in the Exchange card, so the `refresh()` that follows the proposal
 * keeps it on screen even though the builder that asked for it is no longer drawn. Kaizen keeps only a fingerprint, so a link lost here cannot be shown again.
 */
export function ExchangeLinkHolder({ children }: { children: ReactNode }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <ShowLink.Provider value={setLink}>
      {link && <ExchangeLinkPanel link={link} onDone={() => setLink(null)} />}
      {children}
    </ShowLink.Provider>
  );
}

export function ExchangeLinkPanel({ link, onDone }: { link: string; onDone: () => void }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby={`${id}-link`} className="flex flex-col gap-2 rounded-lg border border-brand bg-sunken p-4 text-sm">
      <h3 id={`${id}-link`} className="text-body-strong text-ink">
        The link to the exchange
      </h3>
      <p className={hint}>It is shown only now: Kaizena Flow keeps only a fingerprint of it. Anyone who has it can open the customer&apos;s exchange page. Sending again makes a new one and this one stops working.</p>
      <input readOnly value={link} aria-label="The link to the exchange" onFocus={(e) => e.currentTarget.select()} className={`${field} w-full font-mono text-xs`} />
      <div className="flex gap-2">
        <button
          type="button"
          className={primary}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy the link"}
        </button>
        <button type="button" className={secondary} onClick={onDone}>
          I have copied it
        </button>
      </div>
    </section>
  );
}
