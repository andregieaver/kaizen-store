import type { Metadata } from "next";
import { connection } from "next/server";

import { SiteFontsForm } from "@/components/admin/site-fonts-form";
import { requirePlatformAdmin } from "@/server/auth";
import { getPlatformChrome } from "@/server/platform-navigation";

import { installPlatformFontAction, savePlatformFontsAction } from "./actions";

export const metadata: Metadata = { title: "Fonts" };

/** Kaizen's own fonts (D59). */
export default async function PlatformFontsPage() {
  await connection();
  await requirePlatformAdmin();
  const chrome = await getPlatformChrome();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Fonts</h1>
        <p className="max-w-2xl text-sm text-muted">
          Any Google Fonts family for the headings and other text of Kaizen&apos;s own site. Components on its pages can use
          their own. Fonts are copied to Kaizen and load from the site itself, never from Google. Each store chooses its own
          under Fonts in its admin.
        </p>
      </div>
      <section className="rounded-lg border border-border bg-background p-5">
        <SiteFontsForm fonts={chrome.fonts} action={savePlatformFontsAction} install={installPlatformFontAction} />
      </section>
    </>
  );
}
