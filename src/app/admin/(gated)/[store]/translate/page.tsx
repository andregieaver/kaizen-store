import type { Metadata } from "next";
import Link from "next/link";

import { StoreTranslator } from "@/components/admin/store-translator";
import { pageLanguages } from "@/lib/page-translation";
import { aiFor } from "@/server/ai";
import { requireMember } from "@/server/auth";
import { translationCoverage } from "@/server/store-translate";

import { translateStorePageAction } from "../pages/actions";
import { applyAction, worklistAction } from "./actions";

export const metadata: Metadata = { title: "Translate the store" };

export default async function TranslatePage({ params }: PageProps<"/admin/[store]/translate">) {
  const { store } = await requireMember((await params).store);
  const languages = pageLanguages(store.localization.locales);
  const connection = languages.length > 1 ? await aiFor(store.id) : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Translate the store</h1>
        <p className="text-sm text-muted">
          Products, menus, pages and articles into another of the store&apos;s languages in one go, with AI. The AI
          suggests; you read each text and keep the ones that are right, and nothing is written before you save.
          Pages are saved as drafts, so nothing is published for you.
        </p>
      </div>
      {languages.length < 2 ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm">
          The store has only one language. Add another under{" "}
          <Link href={`/admin/${store.slug}/settings/localization`} className="underline">Languages and currencies</Link>.
        </p>
      ) : !connection?.textModel ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm">
          The store has no AI text model. Choose one under{" "}
          <Link href={`/admin/${store.slug}/settings/ai`} className="underline">Settings → AI</Link>.
        </p>
      ) : (
        <StoreTranslator
          languages={languages}
          coverage={await translationCoverage({ store })}
          actions={{
            worklist: worklistAction.bind(null, store.slug),
            translate: translateStorePageAction.bind(null, store.slug),
            apply: applyAction.bind(null, store.slug),
          }}
        />
      )}
    </div>
  );
}
