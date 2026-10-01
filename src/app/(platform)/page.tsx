import type { Metadata } from "next";
import Link from "next/link";

import { JsonLdScript } from "@/components/json-ld";
import { PlatformPageView, platformPageMetadata } from "@/components/platform-page";
import { storeBase, storeHref } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { platformJsonLd } from "@/lib/structured-data";
import { platformPageForRole } from "@/server/platform-roles";
import { getPlatformSeo, PLATFORM_DEFAULTS } from "@/server/seo";
import { templateStoreSlug } from "@/server/stores";

/** The front page's own search and sharing texts where one of Kaizen's pages is chosen for it (D143). */
export async function generateMetadata(): Promise<Metadata> {
  const page = await platformPageForRole("front");
  return page ? platformPageMetadata(page, "/") : { alternates: { canonical: "/" } };
}

/** The platform's front page: one of Kaizen's own pages where one is chosen (D143), else the standard one. Sign-up opens with the invite-only beta. */
export default async function Home() {
  const chosen = await platformPageForRole("front");
  if (chosen) return <PlatformPageView page={chosen} url="/" front />;
  const [demo, seo] = await Promise.all([templateStoreSlug(), getPlatformSeo()]);
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <JsonLdScript
        data={platformJsonLd({
          origin: siteUrl(),
          name: seo.title.en || PLATFORM_DEFAULTS.title,
          description: seo.description.en || PLATFORM_DEFAULTS.description,
          seo,
        })}
      />
      <h1 className="text-4xl font-semibold tracking-tight">Kaizen</h1>
      <p className="text-lg">
        Online stores for Norway and the EU: prices, VAT, product safety and
        consumer rules handled from the start, and pages that load in under
        half a second.
      </p>
      <p className="text-muted">Kaizen is in a private beta.</p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/sign-up"
          className="rounded-full bg-foreground px-5 py-2.5 font-medium text-background"
        >
          Start your store
        </Link>
        {demo && (
          <Link href={storeHref(demo, storeBase(demo))} className="rounded-full border border-border px-5 py-2.5 font-medium">
            See the demo store
          </Link>
        )}
        <Link href="/admin" className="rounded-full border border-border px-5 py-2.5 font-medium">
          Sign in
        </Link>
      </div>
    </main>
  );
}
