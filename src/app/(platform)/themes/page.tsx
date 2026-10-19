import type { Metadata } from "next";
import { Suspense } from "react";

import { platformPageMetadata, PlatformPageView } from "@/components/platform-page";
import { ThemeStoreList } from "@/components/theme-store-view";
import { parseThemeFilter } from "@/lib/theme-store";
import { themeStoreCards } from "@/server/theme-store";
import { themeStoreUrl } from "@/lib/theme-host";
import { platformPageForRole } from "@/server/platform-roles";

const metadata: Metadata = {
  title: "Themes",
  description: "Free themes for your Kaizena Flow store: preview each on a demo store at computer and phone widths, then start with the one you like.",
};

export async function generateMetadata(): Promise<Metadata> {
  // A page built for it (D285) has its own search texts; either way its address is its own host's once it has one (`docs/theme-phase-3.md` step 3).
  const page = await platformPageForRole("themes");
  if (page) return { ...platformPageMetadata(page, themeStoreUrl()), alternates: { canonical: themeStoreUrl() } };
  return { ...metadata, alternates: { canonical: themeStoreUrl() } };
}

/**
 * The theme store's list (`docs/theme-phase-3.md` step 1): every published theme, filtered by the address. The unfiltered list is
 * prerendered as the fallback, so search engines and a first visit read every theme at once. A page built for it in Kaizena Flow's page
 * builder (D285, edited from Themes) is drawn instead while it is published, its Themes component the same list.
 */
export default async function ThemesPage({ searchParams }: PageProps<"/themes">) {
  const page = await platformPageForRole("themes");
  if (page) return <PlatformPageView page={page} url="/themes" query={searchParams} />;
  const cards = await themeStoreCards();
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Themes</h1>
        <p className="max-w-2xl text-muted">
          A theme is how your store looks: colours, fonts, buttons, sections and, for some, a header, footer and product page of their own.
          Switching never changes your words, pictures, products or menus.
        </p>
      </div>
      <Suspense fallback={<ThemeStoreList cards={cards} filter={{ kind: null, style: null, feature: null }} />}>
        <Filtered cards={cards} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Filtered({ cards, searchParams }: { cards: Awaited<ReturnType<typeof themeStoreCards>>; searchParams: PageProps<"/themes">["searchParams"] }) {
  return <ThemeStoreList cards={cards} filter={parseThemeFilter(await searchParams)} />;
}
