import type { Metadata } from "next";
import Link from "next/link";

import { ExperimentForm } from "@/components/admin/experiment-form";
import { requireMember } from "@/server/auth";
import { describePart, testablePart, type PartKind } from "@/lib/experiment-parts";
import { buttonsOf, formsOf, publishedContentOf, testablePages } from "@/server/experiment-admin";

import { createExperimentAction } from "../actions";

export const metadata: Metadata = { title: "New A/B test" };

export default async function NewExperimentPage({ params, searchParams }: PageProps<"/admin/[store]/experiments/new">) {
  const { store } = await requireMember((await params).store);
  const query = await searchParams;
  const asked = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  let pages = await testablePages(store.id);
  // From the builder's "A/B test this" (D148): one page, and a part of it.
  const partTarget = asked("part") ? { id: asked("part"), kind: asked("kind") as PartKind } : null;
  if (asked("page")) pages = pages.filter((p) => p.id === asked("page"));
  // A working page (the cart, the checkout …) is tested by a part of it only: it is not on the list of whole pages, and a part chosen in the builder reaches it.
  if (!partTarget) pages = pages.filter((p) => !p.partOnly);
  // The buttons and the forms of each page, for a test that counts clicks or forms sent.
  const withButtons = await Promise.all(
    pages.map(async (p) => {
      const content = await publishedContentOf(store.id, p.id);
      return { ...p, buttons: buttonsOf(content), forms: formsOf(content) };
    }),
  );
  let part = null;
  if (partTarget && withButtons[0]) {
    const content = await publishedContentOf(store.id, withButtons[0].id);
    part = content && testablePart(content, partTarget, withButtons[0].kind) ? describePart(content, partTarget) : null;
  }
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
      {asked("page") && pages.length === 0 ? (
        <p role="alert" className="rounded-lg border border-border bg-background p-5 text-sm">
          This page cannot be tested now: it is in a running test, it is not published, or it is a page with a place of
          its own that cannot be tested yet (the cookies page, the blog …). A working page such as the cart is tested by a part of it: choose the part in the page builder.
        </p>
      ) : partTarget && !part ? (
        <p role="alert" className="rounded-lg border border-border bg-background p-5 text-sm">
          That part of the page cannot be tested: it is not in the published page (publish your changes first), or it is a working part of the shop. Go back to
          the page and choose another.
        </p>
      ) : (
        <ExperimentForm pages={withButtons} markets={markets} create={createExperimentAction.bind(null, store.slug)} base={base} part={part} />
      )}
    </div>
  );
}
