"use client";

import { useState } from "react";

import { buttonClass } from "@/components/admin/ui";

type Level = "read" | "propose" | "change";

export type ConsentWords = {
  what: Record<Level, string>;
  stores: string;
  storesHint: string;
  level: string;
  levels: Record<Level, string>;
  choose: string;
  chooseHint: string;
  allow: string;
  cancel: string;
};

/**
 * The consent screen's form (D439, B4): Homer's view is the stores to connect (ticked), one choice of what the app may do (*Read and propose
 * changes* by default) with one sentence of what that means, and Allow. Lisa's step, *Choose permissions*, folds out the permissions one by
 * one, ticked as the level gives them. The server takes the level's scopes, narrowed to what is ticked here, never more than the person
 * holds; without script the boxes stay as drawn and the level still decides.
 */
export function OAuthConsentForm({
  action,
  hidden,
  stores,
  scopes,
  levelScopes,
  words,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  /** `unavailable`: why a store cannot be ticked (the second step, or its owner cut the app off), shown under it. */
  stores: { id: string; name: string; unavailable: string | null }[];
  scopes: { key: string; label: string }[];
  levelScopes: Record<Level, string[]>;
  words: ConsentWords;
}) {
  const [level, setLevel] = useState<Level>("propose");
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(levelScopes.propose));
  const allowed = new Set(levelScopes[level]);
  const choose = (next: Level) => {
    setLevel(next);
    setTicked(new Set(levelScopes[next]));
  };
  const toggle = (key: string, on: boolean) =>
    setTicked((before) => {
      const after = new Set(before);
      if (on) after.add(key);
      else after.delete(key);
      return after;
    });

  return (
    <form action={action} className="flex flex-col gap-6">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body-strong text-ink">{words.stores}</legend>
        {stores.map((store) => (
          <label key={store.id} className="flex items-start gap-3 text-body text-ink">
            <input type="checkbox" name="store" value={store.id} defaultChecked={!store.unavailable} disabled={Boolean(store.unavailable)} className="mt-1 size-4 accent-brand" />
            <span>
              {store.name}
              {store.unavailable && <span className="block text-sm text-muted">{store.unavailable}</span>}
            </span>
          </label>
        ))}
        <p className="text-sm text-muted">{words.storesHint}</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body-strong text-ink">{words.level}</legend>
        {(["read", "propose", "change"] as const).map((option) => (
          <label key={option} className="flex items-center gap-3 text-body text-ink">
            <input type="radio" name="level" value={option} checked={level === option} onChange={() => choose(option)} className="size-4 accent-brand" />
            {words.levels[option]}
          </label>
        ))}
        <p className="text-body text-ink-2" aria-live="polite">
          {words.what[level]}
        </p>
      </fieldset>

      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-body-strong text-ink">{words.choose}</summary>
        <p className="mt-2 text-sm text-muted">{words.chooseHint}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {scopes.map((scope) => (
            <li key={scope.key}>
              <label className="flex items-center gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  name="permission"
                  value={scope.key}
                  checked={allowed.has(scope.key) && ticked.has(scope.key)}
                  disabled={!allowed.has(scope.key)}
                  onChange={(event) => toggle(scope.key, event.target.checked)}
                  className="size-4 accent-brand"
                />
                <span>
                  {scope.label} <code className="font-mono text-xs text-muted">{scope.key}</code>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex flex-wrap gap-3">
        <button type="submit" name="decision" value="approve" className={buttonClass("main", "header")}>
          {words.allow}
        </button>
        <button type="submit" name="decision" value="deny" formNoValidate className={buttonClass("secondary", "header")}>
          {words.cancel}
        </button>
      </div>
    </form>
  );
}
