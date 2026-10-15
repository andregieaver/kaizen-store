import type { Metadata } from "next";
import { connection } from "next/server";

import { SiteFontsForm } from "@/components/admin/site-fonts-form";
import { requirePlatformAdmin } from "@/server/auth";
import { getPlatformChrome } from "@/server/platform-navigation";
import { Card, PageHeader } from "@/components/admin/ui";

import { installPlatformFontAction, savePlatformFontsAction } from "./actions";

export const metadata: Metadata = { title: "Fonts" };

/** Kaizen's own fonts (D59). */
export default async function PlatformFontsPage() {
  await connection();
  await requirePlatformAdmin();
  const chrome = await getPlatformChrome();
  return (
    <>
      <PageHeader
        title="Fonts"
        description={<>Any Google Fonts family for the headings and other text of Kaizena Flow&apos;s own site. Components on its pages can use their own. Fonts are copied to Kaizena Flow and load from the site itself, never from Google. Each store chooses its own under Fonts in its admin.</>}
      />
      <Card compact>
        <SiteFontsForm fonts={chrome.fonts} action={savePlatformFontsAction} install={installPlatformFontAction} />
      </Card>
    </>
  );
}
