"use client";

import { useState, useTransition } from "react";

import type { GooglePlace } from "@/lib/google-reviews";

import { DeleteDiscountButton } from "./delete-discount-button";

type Result = { ok: true } | { ok: false; problems: string[] };

export type GoogleReviewsActions = {
  saveKey: (key: string) => Promise<Result>;
  search: (query: string) => Promise<{ ok: true; places: GooglePlace[] } | { ok: false; problems: string[] }>;
  choose: (placeId: string) => Promise<Result>;
  remove: () => Promise<Result>;
};

const card = "rounded-lg border border-line bg-card p-5";
const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const button = "inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50";

/**
 * Google reviews for testimonials (D91): the owner's Google Maps Platform
 * key, then their business found on Google and chosen.
 */
export function GoogleReviewsSettings({
  hint,
  place,
  actions,
}: {
  /** The saved key's last characters; null when none is saved. */
  hint: string | null;
  place: GooglePlace | null;
  actions: GoogleReviewsActions;
}) {
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<GooglePlace[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  const run = (work: () => Promise<Result | { ok: true; places: GooglePlace[] }>, done: string | null, after?: (result: { ok: true; places?: GooglePlace[] }) => void) =>
    start(async () => {
      setProblems([]);
      setSaved(null);
      const result = await work();
      if (!result.ok) setProblems(result.problems);
      else {
        setSaved(done);
        after?.(result);
      }
    });

  return (
    <div className="flex flex-col gap-6">
      {problems.length > 0 && (
        <div role="alert" className="rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger-text">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}
      {saved && (
        <p role="status" className="text-sm text-positive-text">
          {saved}
        </p>
      )}

      <section aria-labelledby="google-key" className={card}>
        <h2 id="google-key" className="mb-1 text-title text-ink">
          1. Google API key
        </h2>
        <p className="mb-4 text-sm text-muted">
          In Google Cloud, turn on the Places API (New) and create an API key restricted to it. Each page view showing your reviews is one
          request, billed on your Google account after Google&apos;s free monthly amount.
          {hint && <> Saved key: {hint}.</>}
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => actions.saveKey(key), "Key saved.", () => setKey(""));
          }}
        >
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-medium">
            {hint ? "New API key" : "API key"}
            <input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} className={input} />
          </label>
          <button type="submit" disabled={pending || !key.trim()} className={button}>
            Save key
          </button>
        </form>
      </section>

      <section aria-labelledby="google-place" className={card}>
        <h2 id="google-place" className="mb-1 text-title text-ink">
          2. Your business on Google
        </h2>
        <p className="mb-4 text-sm text-muted">
          {place ? (
            <>
              Showing reviews of <strong className="text-ink">{place.name}</strong>
              {place.address && <>, {place.address}</>}.
            </>
          ) : (
            "Find your business as it is on Google Maps, and choose it."
          )}
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => actions.search(query), null, (result) => setFound(result.places ?? []));
          }}
        >
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-medium">
            Business name and town
            <input value={query} disabled={!hint} onChange={(event) => setQuery(event.target.value)} className={input} />
          </label>
          <button type="submit" disabled={pending || !hint || !query.trim()} className={button}>
            Find
          </button>
        </form>
        {found && (
          <ul className="mt-4 flex flex-col gap-2">
            {found.length === 0 && <li className="text-sm text-muted">Google found nothing by that name.</li>}
            {found.map((option) => (
              <li key={option.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3">
                <span className="text-sm">
                  <span className="font-medium">{option.name}</span>
                  <span className="block text-muted">{option.address}</span>
                </span>
                <button
                  type="button"
                  disabled={pending || option.id === place?.id}
                  onClick={() => run(() => actions.choose(option.id), `Showing reviews of ${option.name}.`, () => setFound(null))}
                  className="inline-flex min-h-9 items-center rounded-pill border border-edge px-3 text-sm font-medium hover:bg-sunken disabled:opacity-50"
                >
                  {option.id === place?.id ? "Chosen" : "Choose"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hint && (
        <DeleteDiscountButton
          action={actions.remove}
          code="Google"
          question="Forget the Google key and business? Testimonials showing Google reviews show nothing until they are set up again."
          label="Remove Google reviews"
        />
      )}
    </div>
  );
}
