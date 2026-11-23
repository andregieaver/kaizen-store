import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { SearchTextFields, ShareImageField, SnippetPreview } from "@/components/admin/seo-fields";
import { countWords, fillWords } from "@/lib/admin-fill";
import { DESCRIPTION_ADVICE, LLMS_MAX, RULES_MAX } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { SETTINGS_WORDS } from "@/lib/admin-words/settings";
import { uploadsEnabled } from "@/server/media";
import { getPlatformSeo, PLATFORM_DEFAULTS } from "@/server/seo";

import { savePlatformSeoAction } from "../actions";
import { uploadPlatformImageAction } from "../upload-actions";
import { requirePlatformReader } from "@/server/auth";
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
  await requirePlatformReader();
  const { w, lang } = await platformSiteWords();
  const t = w.seo;
  const seo = await getPlatformSeo();
  const origin = siteUrl();
  const ph = t.phone;
  const snippet = COMMON_WORDS[lang].snippet;
  const title = seo.title.en || PLATFORM_DEFAULTS.title;
  const description = seo.description.en || PLATFORM_DEFAULTS.description;
  const over = description.length - DESCRIPTION_ADVICE;
  const row = { flat: true, change: ph.change, done: ph.close } as const;
  const files = (
    <>
      <a href="/robots.txt" className="underline">
        {"robots.txt"}
      </a>
      ,{" "}
      <a href="/sitemap.xml" className="underline">
        {t.sitemap}
      </a>{" "}
      {t.descriptionAnd}{" "}
      <a href="/llms.txt" className="underline">
        {"llms.txt"}
      </a>
    </>
  );
  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <>
            <span className="sm:hidden">{ph.lead}</span>
            <span className="max-sm:hidden">
              {t.descriptionBefore} {files} {t.descriptionAfter}
            </span>
          </>
        }
      />

      {/* Round 68 (D841): on a phone the front page's search result shows first, and each part of the form below is a row saying what is set. */}
      <SnippetPreview className="bg-card sm:hidden" title={title} description={description} url={`${origin}/`} lang="en" caption={snippet.preview} />

      <ActionForm action={savePlatformSeoAction} successMessage={t.saved} className="flex flex-col gap-6">
        <PhoneRows>
        <PhoneRow
          {...row}
          title={ph.front}
          sub={over > 0 ? <span className="text-warning-text">{countWords(over, ph.tooLong)}</span> : title}
        >
        <section aria-labelledby="home-heading" className={card}>
          <h2 id="home-heading" className="text-title text-ink">
            {t.front}
          </h2>
          <SearchTextFields
            locale="en"
            initial={{ title: seo.title.en ?? "", description: seo.description.en ?? "" }}
            fallback={PLATFORM_DEFAULTS}
            url={`${origin}/`}
            words={snippet}
          />
        </section>
        </PhoneRow>

        <PhoneRow {...row} title={t.share} sub={seo.image ? ph.shareYours : ph.shareDrawn}>
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
            words={SETTINGS_WORDS[lang].seo.shareField}
          />
        </section>
        </PhoneRow>

        <PhoneRow
          {...row}
          last
          title={t.more}
          sub={fillWords(ph.moreSub, {
            profiles: countWords(seo.sameAs.length, ph.profiles),
            ai: seo.llms ? ph.aiText : ph.noAiText,
            codes: seo.verification.google || seo.verification.bing ? ph.codes : ph.noCodes,
          })}
        >
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
        </PhoneRow>
        </PhoneRows>

        <div>
          <SubmitButton>{t.save}</SubmitButton>
        </div>
      </ActionForm>
      <p className="mt-3 text-caption text-ink-2 sm:hidden">
        {ph.files} {files}
      </p>
    </>
  );
}
