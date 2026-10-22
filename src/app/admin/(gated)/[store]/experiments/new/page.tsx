import type { Metadata } from "next";

import { ExperimentForm } from "@/components/admin/experiment-form";
import { requirePermission } from "@/server/permissions";
import { describePart, testablePart, type PartKind } from "@/lib/experiment-parts";
import { buttonsOf, formsOf, publishedContentOf, testablePages } from "@/server/experiment-admin";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { partLabelText } from "@/lib/experiment-words";

import { createExperimentAction } from "../actions";

export const metadata: Metadata = { title: "New A/B test" };

export default async function NewExperimentPage({ params, searchParams }: PageProps<"/admin/[store]/experiments/new">) {
  const { store, account } = await requirePermission((await params).store, "marketing:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "experiments");
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
    const described = content && testablePart(content, partTarget, withButtons[0].kind) ? describePart(content, partTarget) : null;
    part = described ? { ...described, label: partLabelText(described.label, w) } : null;
  }
  const seen = new Set<string>();
  const markets = store.markets.flatMap((m) => (seen.has(m.code) ? [] : (seen.add(m.code), [{ code: m.code.toLowerCase(), name: m.name }])));
  const base = `/admin/${store.slug}/experiments`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["experiments"])}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: w.page.back }} title={w.newTest.title} />
      {asked("page") && pages.length === 0 ? (
        <p role="alert" className={`p-5 text-sm ${CARD_CLASS}`}>
          {w.newTest.cannotPage}
        </p>
      ) : partTarget && !part ? (
        <p role="alert" className={`p-5 text-sm ${CARD_CLASS}`}>
          {w.newTest.cannotPart}
        </p>
      ) : (
        <ExperimentForm pages={withButtons} markets={markets} create={createExperimentAction.bind(null, store.slug)} base={base} part={part} />
      )}
    </div>
    </AdminTextScope>
  );
}
