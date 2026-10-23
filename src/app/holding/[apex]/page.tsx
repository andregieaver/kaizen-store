import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import { holdingFor } from "@/server/holding";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A held domain's holding page (D317 8): its name, "coming soon" in the holder's language, and a small link to Kaizena Flow. Served by the
 * proxy's rewrite for a domain no store uses; any other name is not found. No cookies, no tracking, no scripts of its own.
 */
async function Holding({ params, searchParams }: PageProps<"/holding/[apex]">) {
  const { apex } = await params;
  const name = decodeURIComponent(apex).toLowerCase();
  const held = await holdingFor(name);
  if (held?.kind !== "page" || held.apex !== name) notFound();
  const lang = (await searchParams).lang === "nb" ? "nb" : held.lang;
  const w = platformText(lang).holding;
  return (
    <main lang={lang === "nb" ? "nb-NO" : "en"} className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="break-all text-4xl font-semibold tracking-tight sm:text-5xl">{name}</h1>
      <p className="text-lg text-muted">{w.soon}</p>
      <p className="mt-12 text-sm text-muted">
        <a href={`${siteUrl()}${lang === "nb" ? "/no" : ""}`} className="underline">
          {w.madeWith}
        </a>
      </p>
    </main>
  );
}

export default function HoldingPage(props: PageProps<"/holding/[apex]">) {
  return (
    <Suspense>
      <Holding {...props} />
    </Suspense>
  );
}
