import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SearchTextFields, ShareImageField } from "@/components/admin/seo-fields";
import { LLMS_MAX, RULES_MAX } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { uploadsEnabled } from "@/server/media";
import { getPlatformSeo, PLATFORM_DEFAULTS } from "@/server/seo";

import { savePlatformSeoAction, uploadPlatformImageAction } from "../actions";

export const metadata: Metadata = { title: "Search" };

const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-sm font-normal text-muted";

/** Kaizen's own pages in search, shares and AI assistants, and the site-wide crawler rules (D21). */
export default async function PlatformSeoPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const seo = await getPlatformSeo();
  const origin = siteUrl();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="max-w-2xl text-sm text-muted">
          How Kaizen&apos;s own pages show up in search results, when shared and to AI assistants.
          Each store sets its own under Search in its admin; the site&apos;s{" "}
          <a href="/robots.txt" className="underline">
            robots.txt
          </a>
          ,{" "}
          <a href="/sitemap.xml" className="underline">
            sitemap
          </a>{" "}
          and{" "}
          <a href="/llms.txt" className="underline">
            llms.txt
          </a>{" "}
          bring Kaizen&apos;s and every open store&apos;s together.
        </p>
      </div>

      <ActionForm action={savePlatformSeoAction} successMessage="Search and sharing saved." className="flex flex-col gap-6">
        <section aria-labelledby="home-heading" className={card}>
          <h2 id="home-heading" className="font-medium">
            Front page in search results
          </h2>
          <SearchTextFields
            locale="en"
            initial={{ title: seo.title.en ?? "", description: seo.description.en ?? "" }}
            fallback={PLATFORM_DEFAULTS}
            url={`${origin}/`}
          />
        </section>

        <section aria-labelledby="share-heading" className={card}>
          <h2 id="share-heading" className="font-medium">
            Share picture
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
          <h2 id="more-heading" className="font-medium">
            Profiles, AI assistants and crawlers
          </h2>
          <label className={label}>
            <span>
              Kaizen&apos;s profiles elsewhere <span className={hint}>(one address per line)</span>
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
              Text for AI assistants <span className={hint}>(Markdown, added to llms.txt above the list of stores)</span>
            </span>
            <textarea name="llms" rows={5} maxLength={LLMS_MAX} defaultValue={seo.llms} className={`${input} py-2`} />
          </label>
          <label className={label}>
            <span>
              Extra crawler rules for the whole site <span className={hint}>(robots.txt)</span>
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
            <span className={hint}>
              Admin, sign-in and API addresses, carts and order pages are always left out, and each
              store&apos;s own rules are added. Sitemap lines are allowed here.
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Google Search Console code
              <input name="google" defaultValue={seo.verification.google} spellCheck={false} className={`${input} font-mono`} />
            </label>
            <label className={label}>
              Bing Webmaster Tools code
              <input name="bing" defaultValue={seo.verification.bing} spellCheck={false} className={`${input} font-mono`} />
            </label>
          </div>
        </section>

        <div>
          <SubmitButton>Save search and sharing</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
