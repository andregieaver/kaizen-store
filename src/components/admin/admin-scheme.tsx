"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";

import { ADMIN_SCHEME_KEY, adminScheme, applyAdminScheme, DEFAULT_ADMIN_SCHEME, offeredSchemes, SCHEME_EVENT } from "@/lib/admin-schemes";

/**
 * The admin's colour scheme (D221, docs/admin-style.md 7.3): each account's own choice, kept on the account so it follows them to any
 * device, and in the browser so pages open in it (the admin's first script, `adminSchemeScript()`). The same pattern as light and dark.
 */

export type SaveAdminScheme = (scheme: string) => Promise<void>;

function stored(): string {
  try {
    return adminScheme(localStorage.getItem(ADMIN_SCHEME_KEY)).id;
  } catch {
    return DEFAULT_ADMIN_SCHEME;
  }
}

function subscribe(changed: () => void): () => void {
  window.addEventListener(SCHEME_EVENT, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(SCHEME_EVENT, changed);
    window.removeEventListener("storage", changed);
  };
}

/** Brings this browser in line with the account's scheme, when it was chosen on another device. */
export function AdminSchemeSync({ saved }: { saved: string }) {
  useEffect(() => {
    if (stored() !== adminScheme(saved).id) applyAdminScheme(saved);
  }, [saved]);
  return null;
}

/**
 * Your account's choice of scheme: a card for each offered scheme with its swatch. The swatch shows the scheme's own colours (canvas,
 * rail, brand) from the registry, the one place a fixed colour belongs on an admin page: it is a picture of another scheme.
 */
export function SchemeField({ saved, save }: { saved: string; save: SaveAdminScheme }) {
  const choice = useSyncExternalStore(subscribe, stored, () => adminScheme(saved).id);
  const [pending, start] = useTransition();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Colour scheme</legend>
      <div className="flex flex-wrap gap-3">
        {offeredSchemes().map((scheme) => (
          <label
            key={scheme.id}
            className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border p-2 pb-3 text-sm has-checked:border-foreground has-checked:font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
          >
            <span aria-hidden className="flex h-14 w-32 overflow-hidden rounded-md border border-border" style={{ background: scheme.swatch.canvas }}>
              <span className="h-full w-5" style={{ background: scheme.swatch.rail }} />
              <span className="m-2 flex flex-1 items-end justify-end rounded-sm bg-white/90">
                <span className="m-1.5 h-2.5 w-8 rounded-full" style={{ background: scheme.swatch.brand }} />
              </span>
            </span>
            <span className="flex items-center gap-2 px-1">
              <input
                type="radio"
                name="admin-scheme"
                value={scheme.id}
                checked={choice === scheme.id}
                onChange={() => {
                  applyAdminScheme(scheme.id);
                  start(() => save(scheme.id));
                }}
              />
              {scheme.name}
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {pending ? "Saving …" : "Kept with your account, so the admin looks the same on every device you sign in on."}
      </p>
    </fieldset>
  );
}
