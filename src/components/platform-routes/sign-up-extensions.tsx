import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PolicyLink } from "@/components/policy-link";
import { control, field, SignUpAcceptance } from "@/components/platform-routes/sign-up";
import { requestExtensions } from "@/app/(platform)/sign-up/actions";
import { ReferralKeeper } from "@/app/(platform)/sign-up/referral-keeper";
import { extensionsIn } from "@/lib/extension-words";
import { isExtensionId, STANDALONE_SIGNUP_OPEN } from "@/lib/extensions";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { languageMeta } from "@/server/platform-lang-meta";
import { getPublicExtensions } from "@/server/public-extensions";
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
  const [catalogue, countries, referrals] = await Promise.all([getPublicExtensions(), listCountries(), referralPublicSettings()]);
  const offered = extensionsIn(catalogue, lang).extensions.filter((e) => e.standalone);
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
            <Suspense fallback={<ExtensionChoices offered={offered} ticked={[]} />}>
              <TickedChoices offered={offered} ticked={ticked} />
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

type Offered = { id: string; name: string; description: string }[];

/** The extensions to tick, with those a link asked for ticked. */
function ExtensionChoices({ offered, ticked }: { offered: Offered; ticked: readonly string[] }) {
  return offered.map((e) => (
    <label key={e.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 text-sm transition-colors has-[:checked]:border-foreground">
      <input type="checkbox" name="extension" value={e.id} defaultChecked={ticked.includes(e.id)} className="mt-0.5 size-5 shrink-0 accent-foreground" />
      <span className="flex flex-col gap-1">
        <span className="font-medium">{e.name}</span>
        <span className="text-muted">{e.description}</span>
      </span>
    </label>
  ));
}

/** The same, once the request's `?with=` is read (per request, inside the form's `<Suspense>`). */
async function TickedChoices({ offered, ticked }: { offered: Offered; ticked: Promise<readonly string[]> }) {
  return <ExtensionChoices offered={offered} ticked={(await ticked).filter(isExtensionId)} />;
}
