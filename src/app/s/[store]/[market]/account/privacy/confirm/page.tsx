import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { DeletePlanView, PrivacyDoneView } from "@/components/privacy-account-view";
import { DeleteForm, StepUpForm } from "@/components/privacy-forms";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { deleteLabels, stepUpLabels } from "@/lib/privacy-labels";
import { deleteFactsOf } from "@/lib/privacy-delete-facts";
import { formatPrivacyDay, privacyLanguage, shopperPrivacyText } from "@/lib/privacy-text";
import { shopperBonus } from "@/server/bonus";
import { getCustomer } from "@/server/customers";
import { shopperErasurePlan, shopperPrivacyState } from "@/server/privacy-shopper";
import { resolveShop } from "@/server/shop";
import { pageShopOrMoved } from "@/server/shop-page";

import { confirmStepUpAction, deleteAccountAction, requestStepUpCodeAction } from "../actions";

type Props = PageProps<"/s/[store]/[market]/account/privacy/confirm">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Delete my account (wave 1, 1g, D162): what goes now, what stays and until when, what else happens, then one button. It needs a fresh
 * sign-in, so an older session sees "Confirm it is you" here first. The same address is the result once the account is gone: the session
 * has ended by then, so the counts it needs (how many orders are kept, and the day) are in the address, with no name, email or address.
 */
export default async function DeleteAccountPage({ params, searchParams }: Props) {
  // A country, language or currency the store no longer offers moves to one it does before the boundary, as a 308 (D178).
  await pageShopOrMoved("/account/privacy/confirm");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <DeleteAccount params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** The result's numbers, from the address: whole counts and a real day, or nothing. */
function resultOf(query: Record<string, string | string[] | undefined>): { kept: number; until: string | null; emailSent: boolean } | null {
  if (query.done !== "1") return null;
  const kept = typeof query.kept === "string" && /^\d{1,6}$/.test(query.kept) ? Number(query.kept) : 0;
  const day = typeof query.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.until) ? query.until : null;
  const real = day && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day) ? day : null;
  return { kept, until: real, emailSent: query.mail === "1" };
}

async function DeleteAccount({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  // The shopper's session and the clock are per request: not part of the prerendered page.
  await connection();
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const text = shopperPrivacyText(market.lang);
  const accountLabel = t(market.lang).account.title;
  const state = await shopperPrivacyState(store.id);

  if (!state.signedIn) {
    const result = resultOf(await searchParams);
    if (!result) redirect(`${base}/account`);
    return (
      <PrivacyDoneView
        text={text}
        kept={result.kept}
        until={result.until ? formatPrivacyDay(result.until, privacyLanguage(market.lang)) : null}
        emailSent={result.emailSent}
        accountHref={`${base}/account`}
        accountLabel={accountLabel}
      />
    );
  }

  if (!state.fresh) {
    const customer = await getCustomer(store.id);
    return (
      <>
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-heading tracking-tight">{text.deleteTitle}</h1>
          <p role="status">{text.staleSession}</p>
        </header>
        <StepUpForm
          labels={stepUpLabels(text)}
          hasPassword={Boolean(customer?.hasPassword)}
          requestCode={requestStepUpCodeAction.bind(null, store.slug, market.slug)}
          confirm={confirmStepUpAction.bind(null, store.slug, market.slug, "confirm")}
        />
      </>
    );
  }

  const planned = await shopperErasurePlan(store.id);
  if (!planned.ok) redirect(`${base}/account`);
  // Credits are shown as in My account: in the market's currency, at the store's rates.
  const forfeits = planned.plan.alsoHappens.bonusForfeited.length > 0;
  const bonus = forfeits ? await shopperBonus({ storeId: store.id, market }, state.customerId) : null;
  const shown = bonus ? { currency: bonus.balance.currency, amountMinor: bonus.balance.availableMinor + bonus.balance.pendingMinor } : null;
  return (
    <DeletePlanView
      text={text}
      storeName={store.name}
      facts={deleteFactsOf(planned.plan, market.locale, shown)}
      form={<DeleteForm labels={deleteLabels(text)} erase={deleteAccountAction.bind(null, store.slug, market.slug)} backHref={`${base}/account/privacy`} />}
    />
  );
}
