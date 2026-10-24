"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { browserText } from "@/lib/browser-text";

/** The page's language, from the `<html lang>` the market's layout set (two letters); English while rendered on the server. */
function useLang(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (document.documentElement.lang || "en").split("-")[0],
    () => "en",
  );
}

/**
 * Shown when a store page fails to render, inside the market's layout (header, footer and theme stay), instead of Next's own error
 * page (PSI 2026-10-24, REL-01). Says what happened in the shopper's language, offers to try again and a way back to the store's front
 * door (`/s/{store}` here, `/` on the store's own host, as `storeHome()` gives), and shows the error's reference for support.
 */
export default function StorePageError({ error, retry }: { error: unknown; retry: () => void }) {
  const m = browserText(useLang()).pageError;
  const pathname = usePathname();
  const home = pathname.startsWith("/s/") ? pathname.split("/").slice(0, 3).join("/") : "/";
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="mx-auto flex w-full max-w-(--content-width) flex-col items-start gap-4 px-4 py-16">
      <h1 className="font-heading text-2xl">{m.title}</h1>
      <p>{m.body}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={retry} className="button-primary rounded-button min-h-11 px-5">
          {m.retry}
        </button>
        <a href={home} className="underline">
          {m.home}
        </a>
      </div>
      {digest ? (
        <p className="text-sm opacity-70">
          {m.reference}: {digest}
        </p>
      ) : null}
    </section>
  );
}
