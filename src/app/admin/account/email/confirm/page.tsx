import type { Metadata } from "next";
import { Suspense } from "react";

import { QuietActionForm } from "@/components/admin/quiet-action-form";
import { Button, ButtonLink } from "@/components/admin/ui/button";
import { FocusFrame } from "@/components/admin/ui/focus-frame";
import { fillWords } from "@/lib/admin-fill";
import { BOOKINGS_WORDS } from "@/lib/admin-words/bookings";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getAccount } from "@/server/auth";
import { emailChangeLink } from "@/server/email-change";

import { confirmEmailChangeAction } from "@/app/admin/(gated)/(owner)/account/actions";

// Never in a search engine, and the token in the address never leaves in a Referer when a link on the page is followed. The tab's title stays
// fixed (in English): a title read from the request would stream the page's metadata out of `<head>`.
export const metadata: Metadata = { title: BOOKINGS_WORDS.en.account.confirmEmail.title, robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * What the link of an email change opens (D836): nobody needs to be signed in, as the person may read their new address's mail on another
 * device, and nobody is signed in by it. Opening it changes nothing (a mail scanner that follows links confirms nothing): the page names the
 * new address and its button confirms (`confirmEmailChangeAction()`), after which the page is drawn again for the used link. In the
 * person's own admin language once the link is known, else the request's.
 */
export default function ConfirmEmailPage({ searchParams }: PageProps<"/admin/account/email/confirm">) {
  return (
    <Suspense fallback={<FocusFrame />}>
      <ConfirmEmail searchParams={searchParams} />
    </Suspense>
  );
}

async function ConfirmEmail({ searchParams }: Pick<PageProps<"/admin/account/email/confirm">, "searchParams">) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const link = await emailChangeLink(token);
  const lang = link.state === "unknown" ? await requestAdminLang() : link.lang;
  const w = BOOKINGS_WORDS[lang].account.confirmEmail;

  if (link.state === "used") {
    // Done here or before: Your account for someone signed in on this device, the sign-in page for anyone else.
    const signedIn = Boolean(await getAccount().catch(() => null));
    return (
      <FocusFrame lang={lang} title={w.doneTitle} description={fillWords(w.done, { email: link.email })}>
        {query.done !== "1" && <p className="text-sm text-muted">{w.used}</p>}
        <ButtonLink href={signedIn ? "/admin/account" : "/admin/sign-in"} kind="main" className="w-fit">
          {signedIn ? w.openAccount : w.signIn}
        </ButtonLink>
      </FocusFrame>
    );
  }

  if (link.state !== "valid") {
    return (
      <FocusFrame lang={lang} title={w.notWorking} description={link.state === "expired" ? w.expired : w.unknown}>
        <ButtonLink href="/admin/sign-in" className="w-fit">
          {w.signIn}
        </ButtonLink>
      </FocusFrame>
    );
  }

  // The kit's server Button: the form marks it pressed while it works (`admin.css` spins it), so no words are handed to the browser.
  return (
    <FocusFrame lang={lang} title={w.title} description={<span className="[overflow-wrap:anywhere]">{fillWords(w.description, { email: link.email })}</span>}>
      <QuietActionForm action={confirmEmailChangeAction} className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <div>
          <Button type="submit" kind="main">
            {w.button}
          </Button>
        </div>
      </QuietActionForm>
    </FocusFrame>
  );
}
