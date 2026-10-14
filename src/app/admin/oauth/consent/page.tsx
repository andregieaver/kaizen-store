import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { getAccount } from "@/server/auth";
import { isOwner } from "@/server/kaizen-life";

import { decideConsentAction } from "./actions";
import { FocusFrame, FocusHeading } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Sign in with Kaizen Store" };

/** What each scope an app asks for shares, in words. */
const SCOPE_WORDS: Record<string, string> = {
  openid: "who you are",
  email: "your email address",
  profile: "your name",
  phone: "your phone number",
};

const button = "inline-flex min-h-11 items-center justify-center rounded-md px-5 text-sm font-medium";

/**
 * Supabase's OAuth server sends people here when an app, such as Kaizen
 * Life, asks to sign them in with their Kaizen Store account (D95). They
 * sign in first if they have to, then say yes or no. Only store owners can
 * sign in elsewhere with Kaizen Store. An app they already said yes to is
 * sent straight back.
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
  if (!id) {
    return (
      <FocusFrame>
        <FocusHeading title="This sign-in could not be read" />
        <p className="text-sm">Go back to the app you came from and try again.</p>
      </FocusFrame>
    );
  }
  const account = await getAccount();
  if (!account) redirect(`/admin/sign-in?next=${encodeURIComponent(`/admin/oauth/consent?authorization_id=${id}`)}`);
  if (!(await isOwner(account))) {
    return (
      <FocusFrame>
        <FocusHeading title="For store owners" />
        <p className="text-sm">
          Only store owners can sign in to other apps with their Kaizen Store account. You are signed in as {account.email}.
        </p>
        <form action={decideConsentAction}>
          <input type="hidden" name="authorization_id" value={id} />
          <button type="submit" name="decision" value="deny" className={`${button} border border-line`}>
            Go back
          </button>
        </form>
      </FocusFrame>
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) {
    return (
      <FocusFrame>
        <FocusHeading title="This sign-in has expired" />
        <p className="text-sm">Go back to the app you came from and try again.</p>
      </FocusFrame>
    );
  }
  // Already said yes to this app: straight back.
  if (!("authorization_id" in data)) redirect(data.redirect_url);
  const shares = [...new Set(data.scope.split(/\s+/).map((s) => SCOPE_WORDS[s]).filter(Boolean))];
  const app = data.client.name || "An app";
  return (
    <FocusFrame>
      <FocusHeading title={<>Sign in to {app} with Kaizen Store</>} />
      {failed && (
        <p role="alert" className="text-sm">
          That did not go through. Try again.
        </p>
      )}
      <p className="text-sm">
        {app} will know {shares.length > 0 ? shares.join(", ") : "who you are"}, as {account.email}. It gets nothing from your stores
        this way; letting assistants work with a store is a separate choice.
      </p>
      <form action={decideConsentAction} className="flex gap-3">
        <input type="hidden" name="authorization_id" value={id} />
        <button type="submit" name="decision" value="approve" className={`${button} bg-brand text-brand-ink`}>
          Allow
        </button>
        <button type="submit" name="decision" value="deny" className={`${button} border border-line`}>
          Cancel
        </button>
      </form>
      <p className="text-xs text-muted">
        You can take it back at any time under{" "}
        <Link href="/admin/account" className="underline">
          Your account
        </Link>
        .
      </p>
    </FocusFrame>
  );
}
