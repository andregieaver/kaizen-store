import type { Metadata } from "next";
import { connection } from "next/server";

import { NavigationEditor, type NavigationCopy } from "@/components/admin/navigation-editor";
import type { AnyLinkKind } from "@/lib/navigation";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { termTargets } from "@/lib/taxonomy";
import { listMenuPages } from "@/server/pages";
import { listTerms } from "@/server/taxonomy";
import { getPlatformNavigationForEdit } from "@/server/platform-navigation";

import { uploadPlatformImageAction } from "../actions";
import { savePlatformNavigationAction } from "./actions";

export const metadata: Metadata = { title: "Header and footer" };

const KINDS: { kind: AnyLinkKind; label: string }[] = [
  { kind: "page", label: "A page" },
  { kind: "category", label: "A category's pages" },
  { kind: "tag", label: "A tag's pages" },
  { kind: "blog", label: "The blog" },
  { kind: "article", label: "An article" },
  { kind: "blogCategory", label: "A blog category's articles" },
  { kind: "home", label: "Front page" },
  { kind: "signUp", label: "Start your store (sign-up)" },
  { kind: "signIn", label: "Sign in" },
  { kind: "url", label: "Web address" },
];

const COPY: NavigationCopy = {
  logo: "Shown in the header instead of Kaizen's name, up to 40 pixels high. A wide PNG with a transparent background works best. Without a logo, the header shows the name.",
  logoDark:
    "Optional: a light version of the logo, shown instead to visitors in dark mode. Without it, the logo above is shown in both.",
  header:
    "Across the top on computers, and in the slide-out menu on phones. Sign in and Start your store are always there, so they need no link here.",
  footer: "At the bottom of every page, beside the business details below.",
  saved: "Saved. Kaizen's pages show it now.",
  view: "View the site",
  urlHint: "A full address opens that site; one starting with / is a page on Kaizen's site.",
  urlPlaceholder: "https://… or /sign-up",
};

/** Kaizen's own logo, menus and business details (D42), for the front page, sign-up and every page. */
export default async function PlatformNavigationPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [{ navigation, business }, pages, terms, articles, blogTerms] = await Promise.all([
    getPlatformNavigationForEdit(),
    listMenuPages(null),
    listTerms({ storeId: null, contentType: "page" }),
    listMenuPages(null, "article"),
    listTerms({ storeId: null, contentType: "article" }),
  ]);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Header and footer</h1>
        <p className="max-w-2xl text-sm text-muted">
          Kaizen&apos;s logo, its menus and who runs it, on the front page, sign-up and every page. A link to a page
          follows it to a new address, and shows once the page is published.
        </p>
      </div>
      <NavigationEditor
        initial={navigation}
        languages={[
          { locale: "en", name: "English", defaults: { home: "Home", signUp: "Start your store", signIn: "Sign in", blog: "Blog" } },
        ]}
        kinds={KINDS}
        targets={{
          page: pages.map((page) => ({
            value: page.id,
            title: page.title,
            note: page.published ? undefined : "draft",
          })),
          ...termTargets(terms),
          // Kaizen's articles by id and blog categories by address (D57).
          article: articles.map((a) => ({ value: a.id, title: a.title, note: a.published ? undefined : "draft" })),
          blogCategory: termTargets(blogTerms).category,
        }}
        copy={COPY}
        business={business}
        upload={uploadsEnabled() ? uploadPlatformImageAction : null}
        save={savePlatformNavigationAction}
        previewHref="/"
      />
    </>
  );
}
