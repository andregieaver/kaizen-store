import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PrivacyPageView, type PrivacyNotice } from "@/components/privacy-account-view";
import { StepUpForm } from "@/components/privacy-forms";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { stepUpLabels } from "@/lib/privacy-labels";
import { shopperPrivacyText } from "@/lib/privacy-text";
import { getCustomer } from "@/server/customers";
import { shopperPrivacyState } from "@/server/privacy-shopper";
import { resolveShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { confirmStepUpAction, requestStepUpCodeAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/privacy">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

const NOTICES: readonly PrivacyNotice[] = ["stale", "too_large", "busy", "failed"];

/**
 * Your data (wave 1, 1g, D162): download what the shop holds about the signed-in shopper, or go on to deleting the account. Both need a
 * fresh sign-in (a code emailed to the address on file, or the password, within ten minutes); a session that is older shows only "Confirm it
 * is you". The shopper is the one in this browser's session, never a value from the address. Signed out, this is My account's page instead.
 */
export default async function PrivacyPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/privacy");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Privacy params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Privacy({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  // The shopper's session and the clock are per request: not part of the prerendered page.
  await connection();
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const state = await shopperPrivacyState(store.id);
  if (!state.signedIn) redirect(`${base}/account`);
  const customer = await getCustomer(store.id);
  const wanted = (await searchParams).problem;
  const notice = NOTICES.find((n) => n === wanted) ?? null;
  const text = shopperPrivacyText(market.lang);
  return (
    <PrivacyPageView
      text={text}
      storeName={store.name}
      fresh={state.fresh}
      notice={notice}
      exportHref={`${base}/account/privacy/export`}
      deleteHref={`${base}/account/privacy/confirm`}
      accountHref={`${base}/account`}
      accountLabel={t(market.lang).account.title}
      stepUp={
        <StepUpForm
          labels={stepUpLabels(text)}
          hasPassword={Boolean(customer?.hasPassword)}
          requestCode={requestStepUpCodeAction.bind(null, store.slug, market.slug)}
          confirm={confirmStepUpAction.bind(null, store.slug, market.slug, "privacy")}
        />
      }
    />
  );
}
