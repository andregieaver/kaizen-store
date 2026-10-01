import type { Metadata } from "next";
import Link from "next/link";

import { ExperimentForm } from "@/components/admin/experiment-form";
import { requireMember } from "@/server/auth";
import { buttonsOf, testablePages } from "@/server/experiment-admin";
import { findPublishedPage } from "@/server/pages";

import { createExperimentAction } from "../actions";

export const metadata: Metadata = { title: "New A/B test" };

export default async function NewExperimentPage({ params }: PageProps<"/admin/[store]/experiments/new">) {
  const { store } = await requireMember((await params).store);
  const pages = await testablePages(store.id);
  // The buttons of each page, for a test that counts clicks.
  const withButtons = await Promise.all(
    pages.map(async (p) => {
      const found = await findPublishedPage(store.id, p.slug);
      return { ...p, buttons: buttonsOf(found && "page" in found ? found.page.content : null) };
    }),
  );
  const seen = new Set<string>();
  const markets = store.markets.flatMap((m) => (seen.has(m.code) ? [] : (seen.add(m.code), [{ code: m.code.toLowerCase(), name: m.name }])));
  const base = `/admin/${store.slug}/experiments`;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={base} className="text-sm underline">
          A/B tests
        </Link>
        <h1 className="text-2xl font-semibold">New A/B test</h1>
      </div>
      <ExperimentForm pages={withButtons} markets={markets} create={createExperimentAction.bind(null, store.slug)} base={base} />
    </div>
  );
}
