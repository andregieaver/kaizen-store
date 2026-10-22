import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DesignCards } from "@/components/admin/design-cards";
import { referralPublicSettings } from "@/server/referrals";
import { designChoices } from "@/server/design-presets";

import { requestAccess } from "@/app/(platform)/sign-up/actions";
import { KaizenLifePrefill } from "@/app/(platform)/sign-up/kaizen-life-prefill";
import { ReferralKeeper } from "@/app/(platform)/sign-up/referral-keeper";
import { ThemeFromAddress } from "@/app/(platform)/sign-up/theme-from-address";
import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { languageMeta } from "@/server/platform-lang-meta";

/** Sign-up's search texts in `lang` (D312). */
export async function signUpMetadata(lang: PlatformLang): Promise<Metadata> {
  return {
    title: "Start your store",
    description: "Kaizena Flow is in a private beta. Ask for a store and we will set one up for you.",
    alternates: await languageMeta(lang, "/sign-up"),
  };
}

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-11 rounded-md border border-border bg-background px-3 font-normal";

/** Asking for a store (`docs/platform.md`), in the language the site is drawn in (D312). */
export async function SignUpRoute({ lang }: { lang: PlatformLang }) {
  // The referral program (D131): kept out of the address's way, so the page stays the same for everyone.
  const referrals = await referralPublicSettings();
  // The store templates a new store can start from (D175); with none published, there is nothing to choose.
  // The design profiles to apply after (D176); with none published, there is nothing to choose.
  const designs = await designChoices();
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Start your store</h1>
        <p className="mt-2 text-muted">
          Kaizena Flow is in a private beta. Tell us who you are and we will set up your store, ready
          to try with demo products.
        </p>
      </div>
      <KaizenLifePrefill />
      <ActionForm action={requestAccess} className="flex flex-col gap-4" replaceOnSuccess id="sign-up-form">
        <ReferralKeeper enabled={referrals.enabled} days={referrals.cookieDays} />
        {/* The language the request was made in, for the emails that answer it (D312 P6). */}
        <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
        <label className={field}>
          Your name
          <input name="name" required autoComplete="name" className={control} />
        </label>
        <label className={field}>
          Email
          <input type="email" name="email" required autoComplete="email" className={control} />
        </label>
        <label className={field}>
          Store name
          <input name="storeName" required maxLength={80} autoComplete="organization" className={control} />
          <span className="font-normal text-muted">You can change it later.</span>
        </label>
        {designs.cards.length > 1 && <ThemeFromAddress />}
        {designs.cards.length > 1 && (
          <DesignCards
            cards={designs.cards}
            legend="Theme (optional)"
            hint="Your store starts with the theme's look and its demo store's products and pages, which you remove in one press when yours are in. Preview opens it in a new window; see them all on the Themes page."
          />
        )}
        <label className={field}>
          <span>
            What will you sell? <span className="font-normal text-muted">(optional)</span>
          </span>
          <textarea name="message" rows={3} maxLength={1000} className={`${control} py-2`} />
        </label>
        {/* Hidden from people and screen readers; a filled-in value marks a bot. */}
        <div aria-hidden="true" className="hidden">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <div>
          <SubmitButton>Request a store</SubmitButton>
        </div>
      </ActionForm>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/admin/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
