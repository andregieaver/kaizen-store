import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { startDomainCheckout } from "@/app/(platform)/get-domain/actions";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { domainsPublic } from "@/server/domain-purchases";
import { languageMeta } from "@/server/platform-lang-meta";

export async function getDomainMetadata(lang: PlatformLang): Promise<Metadata> {
  const w = platformText(lang).domainStart;
  return { title: w.title, description: w.description, alternates: await languageMeta(lang, "/get-domain"), robots: { index: false } };
}

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-11 rounded-md border border-border bg-background px-3 font-normal";

/**
 * Where a domain search's *Get started* leads (D317 3): an email for a sign-in link to the checkout, the name chosen kept in the link.
 */
export async function GetDomainRoute({ lang, domain }: { lang: PlatformLang; domain: string | null }) {
  // Until Kaizena Flow sells domains on their own, a name is bought with a store: sign-up keeps it, as before (D315).
  if (!(await domainsPublic())) redirect(`${platformPath(lang, "/sign-up")}${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`);
  const w = platformText(lang).domainStart;
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{w.title}</h1>
        <p className="mt-2 text-muted">{domain ? w.intro.replace("{domain}", domain) : w.introNoDomain}</p>
      </div>
      <ActionForm action={startDomainCheckout} className="flex flex-col gap-4" replaceOnSuccess>
        <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
        <input type="hidden" name="domain" value={domain ?? ""} />
        <label className={field}>
          {w.email}
          <input type="email" name="email" required autoComplete="email" className={control} />
        </label>
        <div aria-hidden="true" className="hidden">
          <input name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <div>
          <SubmitButton>{w.submit}</SubmitButton>
        </div>
        <p className="text-sm text-muted">{w.terms}</p>
      </ActionForm>
    </main>
  );
}
