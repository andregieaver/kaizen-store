import type { Metadata } from "next";
import { Suspense } from "react";

import { SupportThread } from "@/components/chat/support-thread";
import { threadLabels } from "@/components/chat/thread-labels";
import { t } from "@/lib/i18n";
import { emailThread } from "@/server/support-route";

/** Never indexed, and the address (which holds the token) is not passed on as a referrer. */
export const metadata: Metadata = { title: "Your conversation with Kaizena Flow", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A conversation with Kaizen's support opened from its answer email (D216, `docs/support.md` 2.3, step 5): `/support/c/{token}`. As a
 * store's (`/s/{store}/{market}/account/support/{token}`): the token is the whole access, and the layout draws no chat or consent
 * banner here.
 */
export default function KaizenSupportLinkPage({ params }: PageProps<"/support/c/[token]">) {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-2xl animate-pulse rounded-lg bg-surface" />}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: Pick<PageProps<"/support/c/[token]">, "params">) {
  const { token } = await params;
  const m = t("en");
  const thread = await emailThread({ kind: "kaizen" }, token);
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">{m.chat.thread.title("Kaizena Flow")}</h1>
      {thread ? (
        <>
          <p className="text-muted">{m.chat.thread.intro}</p>
          <SupportThread site={{}} conversation={thread.conversation} initial={thread.messages} initialState={thread.state} labels={threadLabels("en")} />
        </>
      ) : (
        <p>{m.chat.thread.gone}</p>
      )}
    </main>
  );
}
