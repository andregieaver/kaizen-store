import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AdminTextProvider } from "@/components/admin/admin-text";
import { EnrolPanel } from "@/components/admin/two-step-panel";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { safeNext } from "@/lib/password";
import { TWO_STEP_PATHS, enrolReasonText } from "@/lib/two-step";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getAssurance } from "@/server/auth";
import { getStore } from "@/server/stores";

import { finishEnrolmentAction, leaveTwoStepAction, startEnrolmentAction } from "../actions";
import { FocusFrame, FocusHeading } from "@/components/admin/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: adminText(await requestAdminLang(), "signIn").titles.setUp };
}

/**
 * Setting up two-step sign-in (wave 1, 1f, docs/wave-1-trust.md 2.6.2): for someone a store or the platform requires it of, who is held
 * here before any admin page; and for anyone who chooses it from Your account. Outside the gated area, so there is no loop. Opening the
 * page makes nothing: the first button does. In the account's language (D312 A1).
 */
export default function SetUpPage({ searchParams }: PageProps<"/admin/sign-in/two-step/set-up">) {
  return (
    <Suspense fallback={<FocusFrame width="wide" />}>
      <SetUp searchParams={searchParams} />
    </Suspense>
  );
}

/** The store a `next` address is in (`/admin/{store}/…`), for the sentence that says which store asks. */
const storeSlugOf = (next: string): string | null => {
  const slug = /^\/admin\/([^/?#]+)/.exec(next)?.[1];
  return slug && !["platform", "account", "stores", "hosting", "sign-in", "oauth"].includes(slug) ? slug : null;
};

async function SetUp({ searchParams }: { searchParams: PageProps<"/admin/sign-in/two-step/set-up">["searchParams"] }) {
  const query = await searchParams;
  const next = safeNext(typeof query.next === "string" ? query.next : undefined, "/admin/account");
  const held = await getAssurance();
  if (!held) redirect("/admin/sign-in");
  const { assurance, account, session } = held;
  if (assurance.state === "challenge") redirect(`${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(next)}`);
  // Already on and passed (an `aal2` session): nothing to set up. Not a redirect: setting it up promotes this very session, and the page is drawn
  // again when the action that did it sets the session's cookies, so a redirect would take the recovery codes away before they were saved.
  const alreadyOn = session.level === "aal2";

  const lang = await requestAdminLang();
  const w = adminText(lang, "signIn");
  let why: string | undefined;
  if (assurance.state === "enrol") {
    const slug = assurance.reason === "store" ? storeSlugOf(next) : null;
    const store = slug ? await getStore(slug) : null;
    why = enrolReasonText(assurance.reason, store?.name, lang);
  }
  return (
    <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "signIn"])}>
      <FocusFrame width="wide" lang={lang}>
        <FocusHeading title={w.setUp.heading} description={fillWords(w.setUp.signedInAs, { email: account.email })} />
        <EnrolPanel
          start={startEnrolmentAction}
          finish={finishEnrolmentAction}
          account={account.email}
          madeOn={new Date().toISOString().slice(0, 10)}
          nextHref={next}
          why={why}
          alreadyOn={alreadyOn}
        />
        {assurance.state === "enrol" && (
          <form action={leaveTwoStepAction}>
            <button type="submit" className="text-sm underline">
              {w.twoStep.signOut}
            </button>
          </form>
        )}
      </FocusFrame>
    </AdminTextProvider>
  );
}
