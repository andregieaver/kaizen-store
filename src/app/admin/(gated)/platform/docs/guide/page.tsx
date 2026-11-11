import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DocsGuideForm } from "@/components/admin/docs-guide-form";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { platformText } from "@/lib/platform-text";
import { aiFor } from "@/server/ai";
import { requirePlatformReader } from "@/server/auth";
import { getDocsGuideForEdit, guideKeeping } from "@/server/docs-guide-settings";
import { uploadsEnabled } from "@/server/media";

import { uploadPlatformImageAction } from "../../actions";
import { saveDocsGuideAction } from "./actions";

export const metadata: Metadata = { title: "Docs guide" };

/**
 * The docs guide (wave 14 unit E5, D444): the AI chat agent on the docs, which answers readers from the docs alone. Homer's settings are
 * the platform chat's (on or off, name, picture, greeting, daily limit); Lisa's (occupation, the picture's frame, guidance) are under
 * Customise. The page says what it needs (the platform's AI with a text model), how long conversations are kept (as the platform chat's) and
 * where the questions it could not answer go (the docs' gap list).
 */
export default async function DocsGuidePage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const w = adminText(lang, "platform").docsGuide;
  const [guide, ai, keeping] = await Promise.all([getDocsGuideForEdit(), aiFor(null), guideKeeping()]);
  const ready = Boolean(ai?.textModel);
  const days = keeping.transcriptDays === 1 ? w.oneDay : fillWords(w.days, { n: keeping.transcriptDays });
  return (
    <AdminTextScope texts={adminTexts(lang, ["platform", "platformTools", "website"])}>
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title={w.title} description={guide.enabled ? (ready ? fillWords(w.onReady, { name: guide.name }) : w.onNoModel) : w.off} />
        <Card title={w.how}>
          <div className="flex flex-col gap-2 text-sm">
            <p>{w.howText}</p>
            <p>{fillWords(w.kept, { days })}</p>
            <p>
              {w.gapsBefore}{" "}
              <Link href="/admin/platform/docs/feedback" className="underline">
                {w.gapsLink}
              </Link>
            </p>
            {!ready && (
              <p className="font-medium">
                {w.needsAi}{" "}
                <Link href="/admin/platform/ai" className="underline">
                  {w.needsAiLink}
                </Link>
              </p>
            )}
          </div>
        </Card>
        <Card title={w.settings}>
          <DocsGuideForm
            guide={guide}
            greetings={{ en: platformText("en").docs.guide.greeting, nb: platformText("nb").docs.guide.greeting }}
            upload={uploadsEnabled() ? uploadPlatformImageAction : null}
            save={saveDocsGuideAction}
          />
        </Card>
      </div>
    </AdminTextScope>
  );
}
