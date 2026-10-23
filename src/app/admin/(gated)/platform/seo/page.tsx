import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SearchTextFields, ShareImageField } from "@/components/admin/seo-fields";
import { LLMS_MAX, RULES_MAX } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { uploadsEnabled } from "@/server/media";
import { getPlatformSeo, PLATFORM_DEFAULTS } from "@/server/seo";

import { savePlatformSeoAction, uploadPlatformImageAction } from "../actions";
import { requirePlatformAdmin } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Search" };

const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-sm font-normal text-muted";

/** Kaizen's own pages in search, shares and AI assistants, and the site-wide crawler rules (D21). */
export default async function PlatformSeoPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const { w } = await platformSiteWords();
  const t = w.seo;
  const seo = await getPlatformSeo();
  const origin = siteUrl();
  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <>
            {t.descriptionBefore}{" "}
            <a href="/robots.txt" className="underline">
              robots.txt
            </a>
            ,{" "}
            <a href="/sitemap.xml" className="underline">
              {t.sitemap}
            </a>{" "}
            {t.descriptionAnd}{" "}
            <a href="/llms.txt" className="underline">
              llms.txt
            </a>{" "}
            {t.descriptionAfter}
          </>
        }
      />

      <ActionForm action={savePlatformSeoAction} successMessage={t.saved} className="flex flex-col gap-6">
        <section aria-labelledby="home-heading" className={card}>
          <h2 id="home-heading" className="text-title text-ink">
            {t.front}
          </h2>
          <SearchTextFields
            locale="en"
            initial={{ title: seo.title.en ?? "", description: seo.description.en ?? "" }}
            fallback={PLATFORM_DEFAULTS}
            url={`${origin}/`}
          />
        </section>

        <section aria-labelledby="share-heading" className={card}>
          <h2 id="share-heading" className="text-title text-ink">
            {t.share}
          </h2>
          <ShareImageField
            upload={uploadsEnabled() ? uploadPlatformImageAction : null}
            initial={seo.image}
            locales={["en"]}
            languageNames={{ en: "English" }}
            generated="/og.png"
          />
        </section>

        <section aria-labelledby="more-heading" className={card}>
          <h2 id="more-heading" className="text-title text-ink">
            {t.more}
          </h2>
          <label className={label}>
            <span>
              {t.profiles} <span className={hint}>{t.profilesHint}</span>
            </span>
            <textarea
              name="sameAs"
              rows={3}
              defaultValue={seo.sameAs.join("\n")}
              spellCheck={false}
              className={`${input} py-2 font-mono`}
            />
          </label>
          <label className={label}>
            <span>
              {t.llms} <span className={hint}>{t.llmsHint}</span>
            </span>
            <textarea name="llms" rows={5} maxLength={LLMS_MAX} defaultValue={seo.llms} className={`${input} py-2`} />
          </label>
          <label className={label}>
            <span>
              {t.robots} <span className={hint}>(robots.txt)</span>
            </span>
            <textarea
              name="robots"
              rows={4}
              maxLength={RULES_MAX}
              defaultValue={seo.robots}
              placeholder={"User-agent: *\nDisallow: /beta"}
              spellCheck={false}
              className={`${input} py-2 font-mono`}
            />
            <span className={hint}>{t.robotsNote}</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              {t.google}
              <input name="google" defaultValue={seo.verification.google} spellCheck={false} className={`${input} font-mono`} />
            </label>
            <label className={label}>
              {t.bing}
              <input name="bing" defaultValue={seo.verification.bing} spellCheck={false} className={`${input} font-mono`} />
            </label>
          </div>
        </section>

        <div>
          <SubmitButton>{t.save}</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
