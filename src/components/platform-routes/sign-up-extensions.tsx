import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PolicyLink } from "@/components/policy-link";
import { ExtensionPicker } from "@/components/platform-routes/extension-picker";
import { control, field, SignUpAcceptance } from "@/components/platform-routes/sign-up";
import { requestExtensions } from "@/app/(platform)/sign-up/actions";
import { ReferralKeeper } from "@/app/(platform)/sign-up/referral-keeper";
import { extensionsIn } from "@/lib/extension-words";
import { foundingShown, paidMonthly } from "@/lib/extension-offer";
import { isExtensionId, STANDALONE_SIGNUP_OPEN, STORE_ONLY_EXTENSIONS } from "@/lib/extensions";
import { signUpWorkspaceText } from "@/lib/messages/sign-up-workspace";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { languageMeta } from "@/server/platform-lang-meta";
import { getPublicExtensions, publicUpsellPercent } from "@/server/public-extensions";
import { referralPublicSettings } from "@/server/referrals";
import { listCountries } from "@/server/stores";

/** The extensions sign-up's search texts in `lang` (D312). */
export async function extensionsSignUpMetadata(lang: PlatformLang): Promise<Metadata> {
  const w = platformText(lang).signUp.extensions;
  return { title: w.title, description: w.description, alternates: await languageMeta(lang, "/sign-up/extensions") };
}

/**
 * The sign-up for extensions (D748 E7, `docs/extensions.md` 7), in the site's language: the extensions sold on their own to tick (a product
 * page links here with its own ticked: `?with=support_desk`), an online store too if wanted, the business's name and country, and the person.
 * The store's sign-up links here, and this page back to it. Without a store the account is made with its workspace; the trials of what was
 * ticked start when it is. The page is prerendered; only the ticks a link asked for are read per request, in their own `<Suspense>`.
 */
export async function ExtensionsSignUpRoute({ lang, ticked }: { lang: PlatformLang; ticked: Promise<readonly string[]> }) {
  if (!STANDALONE_SIGNUP_OPEN) notFound();
  const s = platformText(lang).signUp;
  const w = s.extensions;
  const [catalogue, countries, referrals, nearPercent] = await Promise.all([getPublicExtensions(), listCountries(), referralPublicSettings(), publicUpsellPercent()]);
  const words = extensionsIn(catalogue, lang);
  const founding = foundingShown(catalogue);
  // The picker (D859): the bundles over the extensions sold on their own, each priced a month in every currency the price list has.
  const picker = {
    extensions: words.extensions.filter((e) => e.standalone && e.size).map((e) => ({ id: e.id, name: e.name, description: e.description, prices: paidMonthly(e.size!.prices, founding) })),
    bundles: words.bundles.map((b) => ({ id: b.id, name: b.name, description: b.description, members: b.members, prices: paidMonthly(b.prices, founding) })),
    names: Object.fromEntries(words.extensions.map((e) => [e.id, e.name])),
    partPrices: Object.fromEntries(words.extensions.map((e) => [e.id, e.size ? paidMonthly(e.size.prices, founding) : {}])),
    needsStore: words.extensions.filter((e) => !e.standalone || STORE_ONLY_EXTENSIONS.includes(e.id)).map((e) => e.id),
    currencies: Object.fromEntries(countries.map((c) => [c.code, c.currency])),
    nearPercent,
    lang: PLATFORM_LANG_FACTS[lang].locale,
    w: signUpWorkspaceText(lang).picker,
  };
  const home = lang === "nb" ? "NO" : "";
  return (
    <main id="main" className="flex flex-1 flex-col bg-[radial-gradient(120%_45%_at_50%_0%,rgb(144_128_100/0.18),transparent)]">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{w.title}</h1>
          <p className="mx-auto max-w-lg text-lg text-muted">{w.intro}</p>
        </div>
        <ActionForm
          action={requestExtensions}
          className="flex flex-col gap-6 rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-8"
          replaceOnSuccess
          successClassName="rounded-2xl border border-border bg-background p-6 text-lg shadow-sm sm:p-8"
          id="extensions-sign-up-form"
        >
          <ReferralKeeper enabled={referrals.enabled} days={referrals.cookieDays} />
          <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">{w.pick}</legend>
            <Suspense fallback={<ExtensionPicker {...picker} initial={[]} />}>
              <TickedPicker picker={picker} ticked={ticked} />
            </Suspense>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm transition-colors has-[:checked]:border-foreground">
              <input type="checkbox" name="store" className="mt-0.5 size-5 shrink-0 accent-foreground" />
              <span className="flex flex-col gap-1">
                <span className="font-medium">{w.store}</span>
                <span className="text-muted">{w.storeHint}</span>
              </span>
            </label>
          </fieldset>
          <label className={field}>
            {w.business}
            <input name="storeName" required maxLength={80} autoComplete="organization" className={control} />
            <span className="font-normal text-muted">{w.businessHint}</span>
          </label>
          <label className={field}>
            {w.country}
            <select name="country" required defaultValue={home} className={control}>
              <option value="" disabled>
                {w.choose}
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="font-normal text-muted">{w.countryHint}</span>
          </label>
          <label className={field}>
            {s.name}
            <input name="name" required autoComplete="name" className={control} />
          </label>
          <label className={field}>
            {s.email}
            <input type="email" name="email" required autoComplete="email" className={control} />
          </label>
          <SignUpAcceptance lang={lang} submit={w.submit} />
          <div>
            <SubmitButton>{w.submit}</SubmitButton>
          </div>
          {/* Hidden from people and screen readers; a filled-in value marks a bot. */}
          <div aria-hidden="true" className="hidden">
            <label>
              {s.website}
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
        </ActionForm>
        <p className="text-center text-sm text-muted">
          {w.storeInstead}{" "}
          <PolicyLink policy="intent" href={platformPath(lang, "/sign-up")} className="font-medium text-foreground underline underline-offset-4">
            {w.storeInsteadLink}
          </PolicyLink>
        </p>
      </div>
    </main>
  );
}

/** The picker with what the request's `?with=` asked to tick (per request, inside the form's `<Suspense>`). */
async function TickedPicker({ picker, ticked }: { picker: Omit<Parameters<typeof ExtensionPicker>[0], "initial">; ticked: Promise<readonly string[]> }) {
  const offered = new Set(picker.extensions.map((e) => e.id));
  return <ExtensionPicker {...picker} initial={(await ticked).filter(isExtensionId).filter((id) => offered.has(id))} />;
}
