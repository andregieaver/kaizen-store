import type { Metadata } from "next";
import { connection } from "next/server";

import { SiteFontsForm } from "@/components/admin/site-fonts-form";
import { requirePlatformReader } from "@/server/auth";
import { getPlatformChrome } from "@/server/platform-navigation";
import { Card, PageHeader } from "@/components/admin/ui";

import { installPlatformFontAction, savePlatformFontsAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";
import { AdminAreas } from "@/components/admin/admin-areas";
import { DESIGN_WORDS } from "@/lib/admin-words/design";
import { DESIGN_EDITOR_WORDS } from "@/lib/admin-words/design-editor";

export const metadata: Metadata = { title: "Fonts" };

/** Kaizen's own fonts (D59). */
export default async function PlatformFontsPage() {
  await connection();
  await requirePlatformReader();
  const { w } = await platformSiteWords();
  const chrome = await getPlatformChrome();
  return (
    <AdminAreas areas={{ design: DESIGN_WORDS, designEditor: DESIGN_EDITOR_WORDS }}>
    <>
      <PageHeader
        title={w.misc.fonts.title}
        description={
          <>
            <span className="sm:hidden">{w.misc.fonts.phoneLead}</span>
            <span className="max-sm:hidden">{w.misc.fonts.description}</span>
          </>
        }
      />
      <Card compact>
        <SiteFontsForm fonts={chrome.fonts} action={savePlatformFontsAction} install={installPlatformFontAction} />
      </Card>
    </>
    </AdminAreas>
  );
}
