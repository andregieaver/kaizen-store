import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { previewSignInLink } from "@/server/companies";
import { marketMoved, resolveShop } from "@/server/shop";

import { signInWithLinkAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/sign-in/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Where an emailed sign-in link lands (D108): the button signs in, once.
 * Opening the link changes nothing, so a mail scanner does not spend it.
 */
export default function SignInLinkPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <SignInLink params={params} />
      </Suspense>
    </div>
  );
}

async function SignInLink({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  // A country, language or currency the store no longer offers moves to one it does (D178): the token is in the address, so after the boundary.
  if (!shop) return marketMoved(storeSlug, marketSlug, `/account/sign-in/${token}`);
  const { store, market } = shop;
  const m = t(market.lang).companyAccount;
  const link = await previewSignInLink(store.id, token);

  return (
    <>
      <h1 className="text-3xl font-heading tracking-tight">{m.linkTitle}</h1>
      {link ? (
        <>
          <p>{m.linkIntro(link.email, store.name)}</p>
          <form action={signInWithLinkAction.bind(null, store.slug, market.slug, token)}>
            <button type="submit" className="button-primary min-h-11 rounded-button px-6">
              {m.linkButton}
            </button>
          </form>
        </>
      ) : (
        <>
          <p role="alert">{m.linkGone}</p>
          <Link href={marketPath(store.slug, market.slug, "/account")} className="underline">
            {m.toSignIn}
          </Link>
        </>
      )}
    </>
  );
}
