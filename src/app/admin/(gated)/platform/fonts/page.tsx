import type { Metadata } from "next";
import { connection } from "next/server";

import { SiteFontsForm } from "@/components/admin/site-fonts-form";
import { requirePlatformAdmin } from "@/server/auth";
import { getPlatformChrome } from "@/server/platform-navigation";
import { Card, PageHeader } from "@/components/admin/ui";

import { installPlatformFontAction, savePlatformFontsAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";
import { AdminAreas } from "@/components/admin/admin-areas";

export const metadata: Metadata = { title: "Fonts" };

/** Kaizen's own fonts (D59). */
export default async function PlatformFontsPage() {
  await connection();
  await requirePlatformAdmin();
  const { w } = await platformSiteWords();
  const chrome = await getPlatformChrome();
  return (
    <AdminAreas areas={["design"]}>
    <>
      <PageHeader
        title={w.misc.fonts.title}
        description={w.misc.fonts.description}
      />
      <Card compact>
        <SiteFontsForm fonts={chrome.fonts} action={savePlatformFontsAction} install={installPlatformFontAction} />
      </Card>
    </>
    </AdminAreas>
  );
}
