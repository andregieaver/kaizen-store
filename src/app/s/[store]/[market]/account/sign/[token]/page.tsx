import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ContractSigningForm } from "@/components/contract-signing-form";
import { CONTRACT_CSS, ContractDocumentView } from "@/components/documents/contract-document-view";
import { PayRouteGuard } from "@/components/pay-route-guard";
import { signingText } from "@/lib/contract-signing-text";
import { marketPath } from "@/lib/paths";
import { markViewed, signerByToken } from "@/server/contract-signing";
import { resolveAfterSaleShop } from "@/server/shop";

import { declineAction, requestCodeAction, signAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/sign/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The contract on the store's page: its own styles, without the printed page's margins. */
const SCREEN_CSS = CONTRACT_CSS.replace(/@page\s*\{[^}]*\}/, "");

/**
 * Where a contract's signer reads and signs it (D695 step 3, `docs/contracts.md` 5): from the link in their email, in the store's look and the
 * contract's language. The token is the whole access, so the page is not indexed, the address is not passed on, nothing of the store's
 * tracking, owner code or chat is drawn (`isSignLinkPath()`), and it is entered by a full page load. The contract is drawn from what was
 * sent; the PDF beside it is the file signed. While it is their turn the signer asks for a code, types it with their name, agrees and signs,
 * or declines. A link of another store, a malformed one or a draft's is the not-found page.
 */
export default function SignPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-[210mm] animate-pulse rounded-lg bg-surface" />}>
      <Sign params={params} />
    </Suspense>
  );
}

async function Sign({ params }: Pick<Props, "params">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const view = await signerByToken(token);
  if (!view || view.storeId !== shop.store.id || !view.snapshot) notFound();
  if (view.status === "sent" && !view.viewedAt) {
    const h = await headers();
    await markViewed(token, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null, userAgent: h.get("user-agent") });
  }
  const t = signingText(view.language);
  const w = t.page;
  const locale = view.language === "nb" ? "nb-NO" : "en-GB";
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "long", timeZone: shop.store.timeZone });
  const base = marketPath(shop.store.slug, shop.market.slug);
  const state = view.signedAt
    ? w.signed
    : view.declinedAt
      ? w.declined
      : view.status === "signed" || view.status === "declined" || view.status === "expired" || view.status === "cancelled"
        ? w.closed[view.status]
        : view.expiresAt && new Date(view.expiresAt) <= new Date()
          ? w.closed.expired
          : !view.turn
            ? w.waitingEarlier
            : null;

  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-5" lang={view.language}>
      {/* Entered by a full page load, so no tracking script or owner code from an earlier page is still here to read the token in the address. */}
      <PayRouteGuard store={shop.store.slug} />
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl tracking-tight">{w.title}</h1>
        <p className="text-sm opacity-80">
          {w.from(shop.store.name)}
          {view.status === "sent" && view.expiresAt && !view.signedAt ? ` · ${w.until(day(view.expiresAt))}` : ""}
        </p>
      </header>

      {state && (
        <p role="status" className="rounded-lg border border-current/15 p-4 font-medium">
          {state}
          {view.signedAt ? ` ${w.signedAt(day(view.signedAt))}.` : ""}
        </p>
      )}

      <div className="rounded-lg bg-[#f3f4f6] p-2 sm:p-4">
        <div className="rounded-md bg-white p-5 text-black sm:p-8">
          <style>{SCREEN_CSS}</style>
          <ContractDocumentView snapshot={view.snapshot} level={2} />
        </div>
      </div>
      <p>
        <a href={`${base}/account/sign/${token}/pdf`} className="text-sm font-medium underline">
          {w.download}
        </a>
      </p>

      {view.open && (
        <ContractSigningForm
          words={{
            step1: w.step1,
            sendCode: w.sendCode,
            codeLabel: w.codeLabel,
            nameLabel: w.nameLabel,
            agree: w.agree,
            sign: w.sign,
            decline: w.decline,
            declineReason: w.declineReason,
            declineSend: w.declineSend,
            problems: w.problems,
            heading: w.signAs(view.name),
            codeSent: w.codeSent(view.emailMasked),
          }}
          defaultName={view.name}
          requestCode={requestCodeAction.bind(null, storeSlug, marketSlug, token)}
          sign={signAction.bind(null, storeSlug, marketSlug, token)}
          decline={declineAction.bind(null, storeSlug, marketSlug, token)}
        />
      )}
    </div>
  );
}
