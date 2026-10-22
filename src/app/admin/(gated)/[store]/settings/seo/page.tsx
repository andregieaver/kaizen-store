import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SearchTextFields, ShareImageField } from "@/components/admin/seo-fields";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { t } from "@/lib/i18n";
import { marketUrl, storeBase, storeSiteUrl } from "@/lib/paths";
import { AI_ASSISTANT_BOTS, AI_TRAINING_BOTS, LLMS_MAX, RULES_MAX } from "@/lib/seo";
import { requirePermission } from "@/server/permissions";
import { uploadsEnabled } from "@/server/media";
import { altTextGaps, storeSitemapPath } from "@/server/seo";
import { PageHeader } from "@/components/admin/ui";

import { saveStoreSeoAction } from "../../../actions";
import { uploadImageAction } from "../../products/actions";

export const metadata: Metadata = { title: "SEO & Reach" };

const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-sm font-normal text-muted";

/** How the store shows up in search engines, when shared, and to AI assistants (D21). */
export default async function SeoPage({ params }: PageProps<"/admin/[store]/settings/seo">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "settings").seo;
  const seo = store.seo;
  const gaps = await altTextGaps(store.id);
  const names = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
  const locales = store.localization.locales;
  const languageNames = Object.fromEntries(locales.map((l) => [l, names.of(l) ?? l]));
  // The store's full address: its own host once it has one (P7).
  const origin = storeSiteUrl(store.slug);
  const base = `${origin}${storeBase(store.slug)}`;
  // A store template (D175) is never open to search engines.
  const open = Boolean(store.setupCompletedAt || store.isTemplate) && !store.starter;
  const findable = open && !seo.hidden;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={<>{w.title}</>} description={<>{fillWords(w.description, { store: store.name })}</>} />

      <section aria-labelledby="status-heading" className={card}>
        <h2 id="status-heading" className="text-title text-ink">
          {findable ? w.findable : w.hidden}
        </h2>
        <p className="text-sm">
          {store.starter ? w.starter : !open ? w.notOpen : seo.hidden ? w.hiddenText : w.open}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <li>
            <a href={storeSitemapPath(store.slug)} className="underline">
              {w.sitemap}
            </a>
          </li>
          <li>
            <a href={`${base}/robots.txt`} className="underline">
              {w.robots}
            </a>
          </li>
          <li>
            <a href={`${base}/llms.txt`} className="underline">
              {w.llms}
            </a>
          </li>
        </ul>
        <p className="text-sm text-muted">
          {gaps.pictures === 0
            ? w.noPictures
            : gaps.titleOnly === 0
              ? fillWords(w.allDescribed, { n: gaps.pictures })
              : fillWords(w.titleOnly, { n: gaps.titleOnly, total: gaps.pictures })}{" "}
          {gaps.titleOnly > 0 && (
            <Link href={`/admin/${store.slug}/products`} className="underline">
              {w.goToProducts}
            </Link>
          )}
        </p>
      </section>

      <ActionForm
        action={saveStoreSeoAction.bind(null, store.slug)}
        successMessage={w.savedMessage}
        className="flex flex-col gap-6"
      >
        <section aria-labelledby="home-heading" className={card}>
          <div>
            <h2 id="home-heading" className="text-title text-ink">
              {w.home}
            </h2>
            <p className={hint}>{w.homeHint}</p>
          </div>
          {store.markets.map((market) => (
            <fieldset key={market.code} className="flex min-w-0 flex-col gap-2 border-t border-line pt-4 first-of-type:border-0 first-of-type:pt-0">
              <legend className="text-sm font-medium">
                {market.name} <span className="font-normal text-muted">({languageNames[market.locale]})</span>
              </legend>
              <SearchTextFields
                locale={market.locale}
                initial={{ title: seo.title[market.locale] ?? "", description: seo.description[market.locale] ?? "" }}
                fallback={{ title: store.name, description: t(market.lang).storeSummary(store.name, market.name) }}
                url={marketUrl(store.slug, market.slug)}
                words={adminText(lang, "product").seo}
              />
            </fieldset>
          ))}
        </section>

        <section aria-labelledby="share-heading" className={card}>
          <div>
            <h2 id="share-heading" className="text-title text-ink">
              {w.share}
            </h2>
            <p className={hint}>{w.shareHint}</p>
          </div>
          <ShareImageField
            upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
            initial={seo.image}
            locales={locales}
            languageNames={languageNames}
            generated={`${base}/og.png`}
            words={w.shareField}
          />
        </section>

        <section aria-labelledby="profiles-heading" className={card}>
          <h2 id="profiles-heading" className="text-title text-ink">
            {w.elsewhere}
          </h2>
          <label className={label}>
            <span>
              {w.profiles} <span className={hint}>{w.perLine}</span>
            </span>
            <textarea
              name="sameAs"
              rows={3}
              defaultValue={seo.sameAs.join("\n")}
              placeholder={"https://www.instagram.com/yourstore\nhttps://www.facebook.com/yourstore"}
              spellCheck={false}
              className={`${input} py-2 font-mono`}
            />
            <span className={hint}>{w.profilesHint}</span>
          </label>
        </section>

        <section aria-labelledby="ai-heading" className={card}>
          <div>
            <h2 id="ai-heading" className="text-title text-ink">
              {w.ai}
            </h2>
            <p className={hint}>{w.aiHint}</p>
          </div>
          <input type="hidden" name="aiChoices" value="1" />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="aiAssistants" defaultChecked={seo.aiAssistants} className="mt-0.5 size-4" />
            <span>
              {w.aiAssistants}
              <span className="block text-muted">{AI_ASSISTANT_BOTS.join(", ")}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="aiTraining" defaultChecked={seo.aiTraining} className="mt-0.5 size-4" />
            <span>
              {w.aiTraining}
              <span className="block text-muted">{AI_TRAINING_BOTS.join(", ")}</span>
            </span>
          </label>
          <label className={label}>
            <span>
              {w.ownWords} <span className={hint}>{w.markdown}</span>
            </span>
            <textarea
              name="llms"
              rows={5}
              maxLength={LLMS_MAX}
              defaultValue={seo.llms}
              placeholder={w.ownWordsPlaceholder}
              className={`${input} py-2`}
            />
            <span className={hint}>
              {w.addedUnder}{" "}
              <a href={`${base}/llms.txt`} className="underline">
                llms.txt
              </a>
              {w.addedUnderEnd}
            </span>
          </label>
        </section>

        <section aria-labelledby="advanced-heading" className={card}>
          <h2 id="advanced-heading" className="text-title text-ink">
            {w.advanced}
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="hidden" defaultChecked={seo.hidden} className="mt-0.5 size-4" />
            <span>
              {w.hide}
              <span className="block text-muted">{w.hideHint}</span>
            </span>
          </label>
          <label className={label}>
            <span>
              {w.rules} <span className={hint}>(robots.txt)</span>
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
              {w.rulesHint}{" "}
              <a href={`${base}/robots.txt`} className="underline">
                {w.seeResult}
              </a>
              .
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              <span>
                {w.google} <span className={hint}>{w.googleHint}</span>
              </span>
              <input name="google" defaultValue={seo.verification.google} spellCheck={false} className={`${input} font-mono`} />
            </label>
            <label className={label}>
              <span>
                {w.bing} <span className={hint}>{w.bingHint}</span>
              </span>
              <input name="bing" defaultValue={seo.verification.bing} spellCheck={false} className={`${input} font-mono`} />
            </label>
          </div>
          <p className={hint}>{fillWords(w.consoleHint, { base, sitemap: `${origin}${storeSitemapPath(store.slug)}` })}</p>
        </section>

        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
