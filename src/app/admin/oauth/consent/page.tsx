import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { signInEn } from "@/lib/admin-messages/sign-in.en";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { createClient } from "@/lib/supabase/server";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getAccount } from "@/server/auth";
import { isOwner } from "@/server/kaizen-life";

import { decideConsentAction } from "./actions";
import { FocusFrame, FocusHeading } from "@/components/admin/ui";

/** The tab's title stays fixed (in English): a title read from the request would stream the page's metadata, `noindex` with it, out of `<head>`. */
export const metadata: Metadata = { title: signInEn.titles.consent };

/** What each scope an app asks for shares: its words in the catalogue. */
const SCOPE_WORDS = { openid: "whoYouAre", email: "yourEmail", profile: "yourName", phone: "yourPhone" } as const;

const button = "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-sm font-medium";

/**
 * Supabase's OAuth server sends people here when an app, such as Kaizen
 * Life, asks to sign them in with their Kaizen Store account (D95). They
 * sign in first if they have to, then say yes or no. Only store owners can
 * sign in elsewhere with Kaizen Store. An app they already said yes to is
 * sent straight back. In the account's language, or the browser's before sign-in (D312 A1).
 */
export default function ConsentPage({ searchParams }: PageProps<"/admin/oauth/consent">) {
  return (
    <Suspense fallback={<FocusFrame />}>
      <Consent searchParams={searchParams} />
    </Suspense>
  );
}

async function Consent({ searchParams }: { searchParams: PageProps<"/admin/oauth/consent">["searchParams"] }) {
  const { authorization_id: raw, error: failed } = await searchParams;
  const id = typeof raw === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(raw) ? raw : null;
  const lang = await requestAdminLang();
  const w = adminText(lang, "signIn").consent;
  if (!id) {
    return (
      <FocusFrame lang={lang}>
        <FocusHeading title={w.unreadable} />
        <p className="text-sm">{w.goBackTry}</p>
      </FocusFrame>
    );
  }
  const account = await getAccount();
  if (!account) redirect(`/admin/sign-in?next=${encodeURIComponent(`/admin/oauth/consent?authorization_id=${id}`)}`);
  if (!(await isOwner(account))) {
    return (
      <FocusFrame lang={lang}>
        <FocusHeading title={w.ownersTitle} />
        <p className="text-sm">{fillWords(w.ownersText, { email: account.email })}</p>
        <form action={decideConsentAction}>
          <input type="hidden" name="authorization_id" value={id} />
          <button type="submit" name="decision" value="deny" className={`${button} border border-line`}>
            {w.goBack}
          </button>
        </form>
      </FocusFrame>
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) {
    return (
      <FocusFrame lang={lang}>
        <FocusHeading title={w.expired} />
        <p className="text-sm">{w.goBackTry}</p>
      </FocusFrame>
    );
  }
  // Already said yes to this app: straight back.
  if (!("authorization_id" in data)) redirect(data.redirect_url);
  const shares = [
    ...new Set(
      data.scope
        .split(/\s+/)
        .map((s) => (s in SCOPE_WORDS ? w[SCOPE_WORDS[s as keyof typeof SCOPE_WORDS]] : null))
        .filter(Boolean),
    ),
  ];
  const app = data.client.name || w.anApp;
  return (
    <FocusFrame lang={lang}>
      <FocusHeading title={fillWords(w.heading, { app })} />
      {failed && (
        <p role="alert" className="text-sm">
          {w.failed}
        </p>
      )}
      <p className="text-sm">{fillWords(w.shares, { app, shares: shares.length > 0 ? shares.join(", ") : w.whoYouAre, email: account.email })}</p>
      <form action={decideConsentAction} className="flex gap-3">
        <input type="hidden" name="authorization_id" value={id} />
        <button type="submit" name="decision" value="approve" className={`${button} bg-brand text-brand-ink`}>
          {w.allow}
        </button>
        <button type="submit" name="decision" value="deny" className={`${button} border border-line`}>
          {w.cancel}
        </button>
      </form>
      <p className="text-xs text-muted">
        {w.takeBack}{" "}
        <Link href="/admin/account" className="underline">
          {w.yourAccount}
        </Link>
        .
      </p>
    </FocusFrame>
  );
}
