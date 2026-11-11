import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { t } from "@/lib/i18n";
import { smsTokenView } from "@/server/sms";

import { stopSmsAction } from "./actions";

export const metadata: Metadata = { title: "Text messages", robots: { index: false, follow: false } };

type Props = PageProps<"/sms/[token]">;

/**
 * The stop link in every marketing text (D565, `docs/sms-marketing.md`): the store and the number (masked), and one button that stops its
 * texts. A press, not the link itself, stops them: a phone's link preview opens links on its own. Once stopped, the page says so.
 */
export default function SmsStopPage({ params }: Props) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-12">
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-surface" />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

async function Body({ params }: Pick<Props, "params">) {
  await connection();
  const { token } = await params;
  const view = await smsTokenView(token);
  if (!view) return <p role="alert">{t("en").sms.gone}</p>;
  const lang = view.locale.split("-")[0];
  const m = t(lang).sms;
  if (view.status === "unsubscribed") {
    return (
      <p lang={lang} role="status" className="text-lg">
        {m.stopped(view.storeName)}
      </p>
    );
  }
  return (
    <form lang={lang} action={stopSmsAction.bind(null, token)} className="flex flex-col gap-5">
      <h1 className="text-2xl tracking-tight">{m.pageIntro(view.storeName, view.phone)}</h1>
      <button type="submit" className="min-h-11 self-start rounded-full bg-foreground px-5 font-medium text-background">
        {m.stop}
      </button>
    </form>
  );
}
