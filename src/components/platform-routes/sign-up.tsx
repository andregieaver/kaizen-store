import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/admin/action-form";
import { SignUpLooks } from "@/components/platform-routes/sign-up-looks";
import { referralPublicSettings } from "@/server/referrals";
import { designCardsIn } from "@/lib/design-cards-lang";
import { designChoices } from "@/server/design-presets";
import { selfServeShown } from "@/server/self-signup";

import { requestAccess } from "@/app/(platform)/sign-up/actions";
import { KaizenLifePrefill } from "@/app/(platform)/sign-up/kaizen-life-prefill";
import { ReferralKeeper } from "@/app/(platform)/sign-up/referral-keeper";
import { SignUpWizard, type SignUpStep } from "@/app/(platform)/sign-up/sign-up-wizard";
import { ThemeFromAddress } from "@/app/(platform)/sign-up/theme-from-address";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { PLATFORM_LEGAL_SLUGS } from "@/lib/platform-legal-slugs";
import { platformText } from "@/lib/platform-text";
import { languageMeta } from "@/server/platform-lang-meta";

/** Sign-up's search texts in `lang` (D312). */
export async function signUpMetadata(lang: PlatformLang): Promise<Metadata> {
  return {
    title: platformText(lang).signUp.title,
    description: platformText(lang).signUp.description,
    alternates: await languageMeta(lang, "/sign-up"),
  };
}

const field = "flex flex-col gap-1.5 text-sm font-medium";
const control =
  "min-h-12 rounded-lg border border-border bg-background px-3.5 text-base font-normal transition-colors hover:border-muted focus:border-foreground focus:ring-2 focus:ring-foreground/15 focus:outline-none aria-invalid:border-red-600";

/**
 * Asking for a store (`docs/platform.md`), in the language the site is drawn in (D312), one step at a time (D456): the store's name and what
 * it will sell, its look where themes are published, then the person. The steps are one form (`SignUpWizard`); the server reads it as before.
 */
export async function SignUpRoute({ lang }: { lang: PlatformLang }) {
  // The referral program (D131): kept out of the address's way, so the page stays the same for everyone.
  const referrals = await referralPublicSettings();
  // The looks a new store can start from (D273): with no theme published, there is nothing to choose and no step for it.
  const designs = await designChoices();
  // Self-serve sign-up (D359): the same form, its words saying the store is made at once after the address is confirmed.
  const selfServe = await selfServeShown();
  const w = platformText(lang).signUp;
  const submit = selfServe ? w.selfServe.submit : w.submit;
  const steps: SignUpStep[] = [
    {
      id: "store",
      label: w.steps.store.label,
      title: w.steps.store.title,
      content: (
        <div className="flex flex-col gap-5">
          <label className={field}>
            {w.storeName}
            <input name="storeName" required maxLength={80} autoComplete="organization" className={control} />
            <span className="font-normal text-muted">{w.storeNameHint}</span>
          </label>
          <label className={field}>
            <span>
              {w.sell} <span className="font-normal text-muted">{w.optional}</span>
            </span>
            <textarea name="message" rows={3} maxLength={1000} placeholder={w.sellPlaceholder} className={`${control} py-3`} />
          </label>
          {/* The Dream Factory (D409): only where the store is made at once, as it starts building when the store is made. */}
          {selfServe && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 text-sm transition-colors has-[:checked]:border-foreground">
              <input type="checkbox" name="dream" className="mt-0.5 size-5 shrink-0 accent-foreground" />
              <span className="flex flex-col gap-1">
                <span className="font-medium">{w.selfServe.dream}</span>
                <span className="text-muted">{w.selfServe.dreamHint}</span>
              </span>
            </label>
          )}
        </div>
      ),
    },
    ...(designs.cards.length > 1
      ? [
          {
            id: "look" as const,
            label: w.steps.look.label,
            title: w.steps.look.title,
            hint: w.steps.look.hint,
            content: (
              <>
                <ThemeFromAddress />
                <SignUpLooks cards={designCardsIn(designs.cards, lang, platformText(lang).themeCards)} legend={w.themeLegend} words={platformText(lang).themeCards} />
              </>
            ),
          },
        ]
      : []),
    {
      id: "you",
      label: w.steps.you.label,
      title: w.steps.you.title,
      hint: selfServe ? w.selfServe.youHint : w.steps.you.hint,
      content: (
        <div className="flex flex-col gap-5">
          <label className={field}>
            {w.name}
            <input name="name" required autoComplete="name" className={control} />
          </label>
          <label className={field}>
            {w.email}
            <input type="email" name="email" required autoComplete="email" className={control} />
          </label>
        </div>
      ),
    },
  ];
  return (
    <main id="main" className="flex flex-1 flex-col bg-[radial-gradient(120%_45%_at_50%_0%,rgb(144_128_100/0.18),transparent)]">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{w.title}</h1>
          <p className="mx-auto max-w-lg text-lg text-muted">{selfServe ? w.selfServe.intro : w.intro}</p>
        </div>
        <KaizenLifePrefill words={w.kaizenLife} />
        <ActionForm
          action={requestAccess}
          className="flex flex-col gap-6 rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-8"
          replaceOnSuccess
          successClassName="rounded-2xl border border-border bg-background p-6 text-lg shadow-sm sm:p-8"
          id="sign-up-form"
        >
          <ReferralKeeper enabled={referrals.enabled} days={referrals.cookieDays} />
          {/* The language the request was made in, for the emails that answer it (D312 P6). */}
          <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
          <SignUpWizard
            steps={steps}
            submitLabel={submit}
            words={w.steps}
            note={
              // What sending the form agrees to (PSI REG-02): the terms and the privacy notice, linked; the request records the terms' version.
              <p className="text-sm text-muted">
                {acceptanceParts(w.acceptance, submit).map((part, i) =>
                  part === "{terms}" ? (
                    <Link key={i} href={platformPath(lang, `/${PLATFORM_LEGAL_SLUGS.terms}`)} className="underline">
                      {w.termsLink}
                    </Link>
                  ) : part === "{privacy}" ? (
                    <Link key={i} href={platformPath(lang, `/${PLATFORM_LEGAL_SLUGS.privacy}`)} className="underline">
                      {w.privacyLink}
                    </Link>
                  ) : (
                    <span key={i}>{part}</span>
                  ),
                )}
              </p>
            }
          />
          {/* Hidden from people and screen readers; a filled-in value marks a bot. */}
          <div aria-hidden="true" className="hidden">
            <label>
              {w.website}
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
        </ActionForm>
        <p className="text-center text-sm text-muted">
          {w.haveAccount}{" "}
          <Link href="/admin/sign-in" prefetch={false} className="font-medium text-foreground underline underline-offset-4">
            {w.signIn}
          </Link>
        </p>
      </div>
    </main>
  );
}

/** The acceptance sentence in pieces, the button's words put in and the two links left as `{terms}` and `{privacy}`. */
function acceptanceParts(sentence: string, button: string): string[] {
  return sentence.replace("{button}", button).split(/(\{terms\}|\{privacy\})/).filter((part) => part !== "");
}
