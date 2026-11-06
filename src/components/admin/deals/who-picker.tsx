"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/admin/ui";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { WhoChoice } from "@/lib/deals";

export type WhoWords = Pick<DealsMessages["form"], "who" | "whoSearch" | "whoNone" | "whoChange" | "customer" | "company">;

/**
 * Who a deal is with (S2, D464): one person or one company of the store, found by typing two letters or more of a name, an email or a
 * company. The choice goes with the form as `customerId` or `companyId`; Change starts the search again.
 */
export function WhoPicker({ initial, search, words }: { initial: WhoChoice | null; search: (query: string) => Promise<WhoChoice[]>; words: WhoWords }) {
  const [chosen, setChosen] = useState<WhoChoice | null>(initial);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<WhoChoice[] | null>(null);
  const id = useId();
  useEffect(() => {
    if (query.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const answer = await search(query);
      if (live) setFound(answer);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search]);
  const shown = query.trim().length < 2 ? null : found;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{words.who}</legend>
      <input type="hidden" name="customerId" value={chosen?.kind === "customer" ? chosen.id : ""} />
      <input type="hidden" name="companyId" value={chosen?.kind === "company" ? chosen.id : ""} />
      {chosen ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-card px-3 py-2 text-sm">
          <span>
            <span className="font-medium text-ink">{chosen.label}</span>
            <span className="text-muted"> · {chosen.kind === "customer" ? words.customer : words.company}</span>
            {chosen.detail && <span className="block text-muted">{chosen.detail}</span>}
          </span>
          <Button
            kind="link"
            onClick={() => {
              setChosen(null);
              setQuery("");
              setFound(null);
            }}
          >
            {words.whoChange}
          </Button>
        </div>
      ) : (
        <>
          <input
            id={id}
            type="search"
            aria-label={words.whoSearch}
            placeholder={words.whoSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            className="min-h-10 rounded-md border border-line bg-card px-3 text-sm"
          />
          {shown && (
            <div aria-live="polite">
              {shown.length === 0 ? (
                <p className="text-sm text-muted">{words.whoNone}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
                  {shown.map((choice) => (
                    <li key={`${choice.kind}:${choice.id}`}>
                      <button type="button" className="flex min-h-10 w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => setChosen(choice)}>
                        <span className="text-ink">
                          {choice.label} <span className="text-muted">· {choice.kind === "customer" ? words.customer : words.company}</span>
                        </span>
                        {choice.detail && <span className="text-muted">{choice.detail}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
