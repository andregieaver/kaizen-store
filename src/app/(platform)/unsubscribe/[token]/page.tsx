import type { Metadata } from "next";
import { Suspense } from "react";

import { unsubscribePlanAction } from "./actions";

type Props = PageProps<"/unsubscribe/[token]">;

export const metadata: Metadata = { title: "Plan reminders", robots: { index: false, follow: false } };

/** Stopping Kaizen's reminders about plans (D33): a button, so mail scanners unsubscribe no one. */
export default function UnsubscribePage({ params, searchParams }: Props) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Plan reminders</h1>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-surface" />}>
        <Unsubscribe params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Unsubscribe({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { token } = await params;
  const query = await searchParams;
  if (query.done) return <p role="status">You are unsubscribed. Kaizen will send you no more reminders about plans.</p>;
  if (query.unknown) return <p role="alert">We could not find this link. It may be too old.</p>;
  return (
    <form action={unsubscribePlanAction.bind(null, token)} className="flex flex-col gap-4">
      <p>Stop getting reminders from Kaizen about plans you started paying for? You can turn them on again on your Billing page.</p>
      <button type="submit" className="min-h-11 self-start rounded-full bg-foreground px-5 font-medium text-background">
        Unsubscribe
      </button>
    </form>
  );
}
