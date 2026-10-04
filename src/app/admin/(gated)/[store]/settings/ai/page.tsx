import type { Metadata } from "next";
import Link from "next/link";

import { AiEvalButton, AiImageTestButton, AiProviderForm, AiTestButton } from "@/components/admin/ai-provider-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { providerInfo } from "@/lib/ai-provider";
import { EVAL_CASES, PASS_RATE } from "@/lib/query-eval";
import { getAiSettings, type AiSettings } from "@/server/ai";
import { memberCan, requirePermission } from "@/server/permissions";

import { evalStoreAiAction, removeStoreAiAction, saveStoreAiAction, testStoreAiAction, testStoreImageAction } from "./actions";

export const metadata: Metadata = { title: "AI" };

const card = "rounded-lg border border-border bg-background p-5";

function describe(settings: AiSettings): string {
  const models = [settings.embeddingModel && `search by meaning with ${settings.embeddingModel}`, settings.textModel && `text with ${settings.textModel}`]
    .filter(Boolean)
    .join(", ");
  return `${providerInfo(settings.provider).name}${models ? `: ${models}` : ""}`;
}

/**
 * The store's AI (D73): Kaizen's, included, or the owner's own provider
 * and models with their own key, which replace Kaizen's while on.
 */
export default async function StoreAiPage({ params }: PageProps<"/admin/[store]/settings/ai">) {
  const { store: slug } = await params;
  const staffer = await requirePermission(slug, "settings:read");
  const { store } = staffer;
  const [own, kaizen] = await Promise.all([getAiSettings(store.id), getAiSettings(null)]);
  const owner = memberCan(staffer, "owner");
  const usingOwn = own?.enabled === true;
  const current = usingOwn
    ? `Your own AI · ${describe(own)}`
    : kaizen?.enabled
      ? `Kaizen's AI · ${describe(kaizen)}`
      : "No AI: search finds products by their words only.";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">AI</h1>
        <p className="text-sm text-muted">{current}</p>
        {owner && (
          <p className="mt-1 text-sm">
            <Link href={`/admin/account/usage?store=${store.slug}`} className="underline">
              See the AI usage
            </Link>{" "}
            of this store, per provider and model.
          </p>
        )}
      </div>

      <section aria-labelledby="about" className={card}>
        <h2 id="about" className="mb-1 font-medium">What the store uses AI for</h2>
        <p className="text-sm">
          Search by meaning, so shoppers find products described in other words than theirs. Search still works by the words
          alone whenever the AI does not answer. Kaizen&apos;s AI is included in your plan; you can use your own provider instead,
          paid on your own account with them.
        </p>
      </section>

      <section aria-labelledby="own" className={card}>
        <h2 id="own" className="mb-1 font-medium">Your own AI provider</h2>
        {owner ? (
          <>
            <p className="mb-4 text-sm text-muted">
              Your products and shoppers&apos; searches are then sent to the provider you choose, so make sure your agreement with
              them covers personal data (a data processing agreement), and prefer one that keeps data in the EU.
            </p>
            <AiProviderForm
              action={saveStoreAiAction.bind(null, store.slug)}
              settings={own}
              submitLabel={own ? "Save" : "Use my own AI"}
            />
          </>
        ) : (
          <p className="text-sm">Only an owner can choose the store&apos;s AI.</p>
        )}
      </section>

      {own && owner && (
        <section aria-labelledby="test" className={card}>
          <h2 id="test" className="mb-1 font-medium">Test</h2>
          <p className="mb-3 text-sm text-muted">Tries your saved models now, even while off.</p>
          <AiTestButton action={testStoreAiAction.bind(null, store.slug)} />
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-sm text-muted">
              Searches such as &ldquo;lampe under 500 kr&rdquo; are read by the text model as filters. This runs the eval: {EVAL_CASES.length} searches in
              Norwegian, Swedish, Danish and English, with the filters a good answer gives; a model passes at {Math.round(PASS_RATE * 100)} %.
            </p>
            <AiEvalButton action={evalStoreAiAction.bind(null, store.slug)} />
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-sm text-muted">Makes one small picture with the saved picture model, to see it works and how it looks. It costs one picture.</p>
            <AiImageTestButton action={testStoreImageAction.bind(null, store.slug)} />
          </div>
          <div className="mt-4">
            <DeleteDiscountButton
              action={removeStoreAiAction.bind(null, store.slug)}
              code="your AI provider"
              label="Go back to Kaizen's AI"
              question="Forget your own AI provider and its key, and use Kaizen's again?"
            />
          </div>
        </section>
      )}
    </div>
  );
}
