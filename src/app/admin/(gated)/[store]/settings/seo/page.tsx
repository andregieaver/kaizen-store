import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SearchTextFields, ShareImageField } from "@/components/admin/seo-fields";
import { t } from "@/lib/i18n";
import { marketPath, storeBase } from "@/lib/paths";
import { AI_ASSISTANT_BOTS, AI_TRAINING_BOTS, LLMS_MAX, RULES_MAX } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { requireMember } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { altTextGaps, storeSitemapPath } from "@/server/seo";

import { saveStoreSeoAction } from "../../../actions";
import { uploadImageAction } from "../../products/actions";

export const metadata: Metadata = { title: "SEO & Reach" };

const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-sm font-normal text-muted";

/** How the store shows up in search engines, when shared, and to AI assistants (D21). */
export default async function SeoPage({ params }: PageProps<"/admin/[store]/settings/seo">) {
  const { store } = await requireMember((await params).store);
  const seo = store.seo;
  const gaps = await altTextGaps(store.id);
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const locales = [...new Set(store.markets.map((m) => m.locale))];
  const languageNames = Object.fromEntries(locales.map((l) => [l, names.of(l) ?? l]));
  const origin = siteUrl();
  const base = storeBase(store.slug);
  const open = Boolean(store.setupCompletedAt || store.isTemplate);
  const findable = open && !seo.hidden;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">SEO &amp; Reach</h1>
        <p className="text-sm text-muted">
          How {store.name} shows up in Google and Bing, when a link is shared, and to AI assistants such
          as ChatGPT and Claude. Kaizen fills in what it can from your products and business details;
          everything here is optional.
        </p>
      </div>

      <section aria-labelledby="status-heading" className={card}>
        <h2 id="status-heading" className="font-medium">
          {findable ? "Search engines can find your store" : "Search engines are asked to leave your store out"}
        </h2>
        <p className="text-sm">
          {!open
            ? "Your store is not opened yet. Once you finish the setup, search engines are welcome."
            : seo.hidden
              ? "You have hidden the store below. Shoppers with the link can still buy."
              : "Kaizen tells search engines about every product, in every country you sell to, with prices, stock, shipping and your return policy."}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <li>
            <a href={storeSitemapPath(store.slug)} className="underline">
              Sitemap
            </a>
          </li>
          <li>
            <a href={`${base}/robots.txt`} className="underline">
              Crawler rules (robots.txt)
            </a>
          </li>
          <li>
            <a href={`${base}/llms.txt`} className="underline">
              Summary for AI assistants (llms.txt)
            </a>
          </li>
        </ul>
        <p className="text-sm text-muted">
          {gaps.pictures === 0
            ? "No product pictures yet."
            : gaps.titleOnly === 0
              ? `All ${gaps.pictures} product pictures have their own description.`
              : `${gaps.titleOnly} of ${gaps.pictures} product pictures are described only by the product's title in some language. A few words on what each picture shows helps people using screen readers and image search.`}{" "}
          {gaps.titleOnly > 0 && (
            <Link href={`/admin/${store.slug}/products`} className="underline">
              Go to products
            </Link>
          )}
        </p>
      </section>

      <ActionForm
        action={saveStoreSeoAction.bind(null, store.slug)}
        successMessage="SEO & Reach saved."
        className="flex flex-col gap-6"
      >
        <section aria-labelledby="home-heading" className={card}>
          <div>
            <h2 id="home-heading" className="font-medium">
              Your front page in search results
            </h2>
            <p className={hint}>Empty fields use the store&apos;s name and a line Kaizen writes.</p>
          </div>
          {store.markets.map((market) => (
            <fieldset key={market.code} className="flex min-w-0 flex-col gap-2 border-t border-border pt-4 first-of-type:border-0 first-of-type:pt-0">
              <legend className="text-sm font-medium">
                {market.name} <span className="font-normal text-muted">({languageNames[market.locale]})</span>
              </legend>
              <SearchTextFields
                locale={market.locale}
                initial={{ title: seo.title[market.locale] ?? "", description: seo.description[market.locale] ?? "" }}
                fallback={{ title: store.name, description: t(market.lang).storeSummary(store.name, market.name) }}
                url={`${origin}${marketPath(store.slug, market.slug)}`}
              />
            </fieldset>
          ))}
        </section>

        <section aria-labelledby="share-heading" className={card}>
          <div>
            <h2 id="share-heading" className="font-medium">
              Share picture
            </h2>
            <p className={hint}>
              Shown when someone shares your store on Facebook, LinkedIn, Messenger, Slack and the like.
              Product pages use the product&apos;s own first picture.
            </p>
          </div>
          <ShareImageField
            upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
            initial={seo.image}
            locales={locales}
            languageNames={languageNames}
            generated={`${base}/og.png`}
          />
        </section>

        <section aria-labelledby="profiles-heading" className={card}>
          <h2 id="profiles-heading" className="font-medium">
            Your business elsewhere
          </h2>
          <label className={label}>
            <span>
              Social profiles and listings <span className={hint}>(one address per line)</span>
            </span>
            <textarea
              name="sameAs"
              rows={3}
              defaultValue={seo.sameAs.join("\n")}
              placeholder={"https://www.instagram.com/yourstore\nhttps://www.facebook.com/yourstore"}
              spellCheck={false}
              className={`${input} py-2 font-mono`}
            />
            <span className={hint}>Helps search engines connect your store to your business.</span>
          </label>
        </section>

        <section aria-labelledby="ai-heading" className={card}>
          <div>
            <h2 id="ai-heading" className="font-medium">
              AI assistants
            </h2>
            <p className={hint}>
              Kaizen gives AI assistants a summary of your store, terms and products with prices
              (llms.txt), so they can answer shoppers and link to you.
            </p>
          </div>
          <input type="hidden" name="aiChoices" value="1" />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="aiAssistants" defaultChecked={seo.aiAssistants} className="mt-0.5 size-4" />
            <span>
              Let AI search and assistants read the store to answer people&apos;s questions
              <span className="block text-muted">{AI_ASSISTANT_BOTS.join(", ")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="aiTraining" defaultChecked={seo.aiTraining} className="mt-0.5 size-4" />
            <span>
              Let AI companies use the store&apos;s texts and pictures to train their models
              <span className="block text-muted">{AI_TRAINING_BOTS.join(", ")}</span>
            </span>
          </label>
          <label className={label}>
            <span>
              Your own words for AI assistants <span className={hint}>(Markdown, optional)</span>
            </span>
            <textarea
              name="llms"
              rows={5}
              maxLength={LLMS_MAX}
              defaultValue={seo.llms}
              placeholder="What makes the store special, who it is for, how you help customers choose …"
              className={`${input} py-2`}
            />
            <span className={hint}>
              Added under the summary in{" "}
              <a href={`${base}/llms.txt`} className="underline">
                llms.txt
              </a>
              , above the list of products Kaizen keeps up to date.
            </span>
          </label>
        </section>

        <section aria-labelledby="advanced-heading" className={card}>
          <h2 id="advanced-heading" className="font-medium">
            Advanced
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="hidden" defaultChecked={seo.hidden} className="mt-0.5 size-4" />
            <span>
              Ask search engines to leave the store out
              <span className="block text-muted">
                For a store that should be reached only by its link. Takes effect as search engines
                visit again.
              </span>
            </span>
          </label>
          <label className={label}>
            <span>
              Extra crawler rules <span className={hint}>(robots.txt)</span>
            </span>
            <textarea
              name="robots"
              rows={4}
              maxLength={RULES_MAX}
              defaultValue={seo.robots}
              placeholder={"User-agent: *\nDisallow: /no/p/old-product"}
              spellCheck={false}
              className={`${input} py-2 font-mono`}
            />
            <span className={hint}>
              Write paths from the store&apos;s front door (such as /no/p/product); Kaizen adds the
              store&apos;s address. Carts and order pages are always left out.{" "}
              <a href={`${base}/robots.txt`} className="underline">
                See the result
              </a>
              .
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              <span>
                Google Search Console code <span className={hint}>(HTML tag method)</span>
              </span>
              <input name="google" defaultValue={seo.verification.google} spellCheck={false} className={`${input} font-mono`} />
            </label>
            <label className={label}>
              <span>
                Bing Webmaster Tools code <span className={hint}>(meta tag method)</span>
              </span>
              <input name="bing" defaultValue={seo.verification.bing} spellCheck={false} className={`${input} font-mono`} />
            </label>
          </div>
          <p className={hint}>
            In Search Console, add the address {origin}
            {base}/ as a URL-prefix property and paste the code or the whole tag here. Then submit the
            sitemap: {origin}
            {storeSitemapPath(store.slug)}.
          </p>
        </section>

        <div>
          <SubmitButton>Save search and sharing</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
