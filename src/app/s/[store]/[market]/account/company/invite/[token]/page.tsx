import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AcceptForm } from "@/components/company-forms";
import { t } from "@/lib/i18n";
import { previewInvite } from "@/server/companies";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/account/company/invite/[token]">;

// The link is for one person: never indexed, and no referrer leaves the page.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The page an employee's invitation opens (D108): who invites them, to
 * what, and a button that accepts. Nothing changes until the button is
 * pressed, so an email scanner opening the link accepts nothing.
 */
export default function InvitePage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-surface" />}>
        <Invite params={params} />
      </Suspense>
    </div>
  );
}

async function Invite({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m = t(market.lang).companyAccount;
  const preview = await previewInvite(store.id, token);

  if (!preview.ok) {
    const problems = { gone: m.problemGone, expired: m.problemExpired, company_off: m.problemCompanyOff, full: m.problemFull, other_company: m.problemOtherCompany };
    return (
      <>
        <h1 className="text-3xl font-heading tracking-tight">{m.inviteBoxTitle(store.name)}</h1>
        <p role="alert">{problems[preview.problem]}</p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-heading tracking-tight">{m.inviteBoxTitle(preview.company)}</h1>
      <div className="flex flex-col gap-2">
        <p>{m.inviteBoxIntro(preview.company, preview.store)}</p>
        <p className="text-sm text-muted">{m.inviteFor(preview.email)}</p>
        {preview.percent && <p className="text-sm">{m.inviteDiscount(String(preview.percent))}</p>}
      </div>
      <AcceptForm
        store={store.slug}
        market={market.slug}
        token={token}
        email={preview.email}
        labels={{
          accept: m.accept,
          accepting: m.accepting,
          title: m.acceptedTitle,
          already: m.acceptedAlready,
          existing: m.acceptedExisting(preview.email),
          created: m.acceptedNew(preview.email),
        }}
      />
    </>
  );
}
