import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { FeatureOffNote } from "@/components/admin/feature-off";
import { TERMS_MODES, TERMS_MODE_WORDS, termsSettingNotice, type TermsMode } from "@/lib/checkout-terms";
import { LEGAL_ROLE_COPY, isLegalRole } from "@/lib/legal-roles";
import type { LegalOverview } from "@/server/legal-starters";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const field = "min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal";

/** The notice every starter carries, in the owner's words: written by hand, not checked by a lawyer, never advice. */
export const LEGAL_STARTER_NOTICE =
  "The starters are drafts written by hand from your store's details, in Norwegian, Swedish, Danish and English. They are a starting point, not legal advice, and no lawyer has checked them. Read every sentence, fill in the [[bracketed]] parts, and have the texts reviewed before you rely on them.";

/**
 * The legal pages (wave 1, 1e, docs/wave-1-trust.md 2.1, 2.4): for each kind, the published page chosen for it and a starter draft to begin from;
 * what checkout says about the terms. A starter is only ever a draft: it never overwrites a page, is not in the sitemap until published, and
 * regenerating makes another draft. One page holds one role, so the terms and the privacy statement are two pages.
 */
export function LegalPagesPanel({
  overview,
  storeSlug,
  actions,
}: {
  overview: LegalOverview;
  storeSlug: string;
  actions: { createStarter: (kind: string, state: FormState, formData: FormData) => Promise<FormState>; setRole: (role: string, state: FormState, formData: FormData) => Promise<FormState>; setTerms: Action };
}) {
  const base = `/admin/${storeSlug}`;
  const termsPage = overview.roles.find((r) => r.role === "terms")?.page;
  const privacyPage = overview.roles.find((r) => r.role === "privacy")?.page;
  const shown = [termsPage && { role: "terms" as const, title: termsPage.title, href: "#" }, privacyPage && { role: "privacy" as const, title: privacyPage.title, href: "#" }].filter(
    (p): p is { role: "terms" | "privacy"; title: string; href: string } => Boolean(p),
  );
  const notice = termsSettingNotice(overview.termsAtCheckout as TermsMode, shown);

  return (
    <div className="flex flex-col gap-8">
      <p role="note" className="rounded-lg border border-border bg-background p-4 text-sm">
        <strong className="font-semibold">Draft texts need a person&apos;s review.</strong> {LEGAL_STARTER_NOTICE}
      </p>

      {overview.missing.length > 0 && (
        <section aria-labelledby="missing-heading" className="rounded-lg border border-border bg-background p-4 text-sm">
          <h2 id="missing-heading" className="mb-1 font-medium">
            Details the starters need and the store has not given
          </h2>
          <p className="mb-2 text-muted">A starter shows a visible [[Add: …]] where a detail is missing. Fill these in first and the starters will carry them.</p>
          <ul className="list-disc pl-5">
            {overview.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-2">
            <Link href={`${base}/settings/company`} className="underline">
              Company details
            </Link>
          </p>
        </section>
      )}

      <ul className="flex flex-col gap-4">
        {overview.roles.map((entry) => (
          <li key={entry.role} className="rounded-lg border border-border bg-background p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{entry.name}</h2>
              <span className="text-sm text-muted">{entry.page ? `Chosen: ${entry.page.title}` : "No page chosen"}</span>
            </div>
            <p className="mb-4 text-sm text-muted">{entry.hint}</p>
            {!entry.needed && (
              <p role="note" className="mb-4 text-sm">
                Not needed while the online shop is off: the store sells nothing, so the footer does not link it. What is chosen is kept for when
                the shop is on again.
              </p>
            )}
            <div className="flex flex-wrap items-start gap-6">
              <ActionForm action={actions.setRole.bind(null, entry.role)} className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Page for {entry.name}</span>
                  <select name="page" defaultValue={entry.page?.id ?? ""} className={`${field} max-w-xs`}>
                    <option value="">None: nothing chosen</option>
                    {overview.choosable.map((page) => {
                      const other = page.role && page.role !== entry.role;
                      const name = page.role && isLegalRole(page.role) ? LEGAL_ROLE_COPY[page.role].name : page.role;
                      return (
                        <option key={page.id} value={page.id} disabled={Boolean(other)}>
                          {page.title}
                          {other ? ` (already the ${name?.toLowerCase()})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <SubmitButton variant="secondary">
                  Choose<span className="sr-only"> page for {entry.name}</span>
                </SubmitButton>
              </ActionForm>
              {entry.starter ? (
                <ActionForm action={actions.createStarter.bind(null, entry.role)} className="flex flex-col gap-1">
                  <div>
                    <SubmitButton variant="secondary">
                      {entry.draft ? "Create a new draft" : "Create a starter draft"}
                      <span className="sr-only"> of {entry.name}</span>
                    </SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-sm">
                  <Link href={`${base}/settings/accessibility`} className="underline">
                    Made on the Accessibility page
                  </Link>
                </p>
              )}
            </div>
            {entry.draft && (
              <p className="mt-3 text-sm text-muted">
                Latest starter: <Link href={`${base}/pages/${entry.draft.id}`} className="underline">{entry.draft.title}</Link>{" "}
                {entry.draft.published ? "(published, not the one chosen above)" : "(a draft, not published)"}.
              </p>
            )}
          </li>
        ))}
      </ul>

      {!overview.shopOn ? (
        <section aria-labelledby="checkout-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="checkout-heading" className="mb-1 font-medium">
            At checkout
          </h2>
          <FeatureOffNote storeSlug={storeSlug} feature="shop" owner what="What checkout says about the terms" />
        </section>
      ) : (
      <section aria-labelledby="checkout-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="checkout-heading" className="mb-1 font-medium">
          At checkout
        </h2>
        <p className="mb-4 text-sm text-muted">
          What shoppers are shown next to the pay button, using the pages chosen above for the terms and the privacy statement. Whatever is shown is kept
          with the order: the pages as they were when the shopper pressed pay. A tick box guards and records; it cannot stop a shopper who bypasses the page.
        </p>
        <ActionForm action={actions.setTerms} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">What checkout shows about the terms</legend>
            {TERMS_MODES.map((mode) => (
              <label key={mode} className="flex items-start gap-2 text-sm">
                <input type="radio" name="mode" value={mode} defaultChecked={overview.termsAtCheckout === mode} className="mt-1 size-4" />
                <span>
                  <span className="font-medium">{TERMS_MODE_WORDS[mode].name}</span>
                  <span className="block text-muted">{TERMS_MODE_WORDS[mode].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <div>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </section>
      )}
    </div>
  );
}
