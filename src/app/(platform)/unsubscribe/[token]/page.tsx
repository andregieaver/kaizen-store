import type { Metadata } from "next";
import { Suspense } from "react";

import { platformText } from "@/lib/platform-text";

import { unsubscribePlanAction } from "./actions";

type Props = PageProps<"/unsubscribe/[token]">;

const w = platformText("en").unsubscribe;

export const metadata: Metadata = { title: w.title, robots: { index: false, follow: false } };

/** Stopping Kaizen's reminders about plans (D33): a button, so mail scanners unsubscribe no one. */
export default function UnsubscribePage({ params, searchParams }: Props) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{w.title}</h1>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-surface" />}>
        <Unsubscribe params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Unsubscribe({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { token } = await params;
  const query = await searchParams;
  if (query.done) return <p role="status">{w.done}</p>;
  if (query.unknown) return <p role="alert">{w.unknown}</p>;
  return (
    <form action={unsubscribePlanAction.bind(null, token)} className="flex flex-col gap-4">
      <p>{w.ask}</p>
      <button type="submit" className="min-h-11 self-start rounded-full bg-foreground px-5 font-medium text-background">
        {w.button}
      </button>
    </form>
  );
}
