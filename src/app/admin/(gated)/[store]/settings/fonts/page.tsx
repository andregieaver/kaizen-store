import type { Metadata } from "next";

import { SiteFontsForm } from "@/components/admin/site-fonts-form";
import { requireMember } from "@/server/auth";

import { installStoreFontAction, saveStoreFontsAction } from "./actions";

export const metadata: Metadata = { title: "Fonts" };

/** The store's own fonts (D59). */
export default async function StoreFontsPage({ params }: PageProps<"/admin/[store]/settings/fonts">) {
  const { store } = await requireMember((await params).store);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fonts</h1>
        <p className="max-w-2xl text-sm text-muted">
          Choose any Google Fonts family for your store&apos;s headings and its other text. Components on your pages can
          use their own. Fonts are copied to Kaizen and load from your store itself: fast, and without sending shoppers to
          Google.
        </p>
      </div>
      <section className="rounded-lg border border-border bg-background p-5">
        <SiteFontsForm
          fonts={store.fonts}
          action={saveStoreFontsAction.bind(null, store.slug)}
          install={installStoreFontAction.bind(null, store.slug)}
        />
      </section>
    </div>
  );
}
