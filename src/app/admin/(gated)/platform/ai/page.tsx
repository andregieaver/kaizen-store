import type { Metadata } from "next";
import Link from "next/link";

import { AiEvalButton, AiImageTestButton, AiProviderForm, AiTestButton } from "@/components/admin/ai-provider-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { providerInfo } from "@/lib/ai-provider";
import { EVAL_CASES, PASS_RATE } from "@/lib/query-eval";
import { countStoresWithOwnAi, getAiSettings } from "@/server/ai";
import { requirePlatformAdmin } from "@/server/auth";

import { evalPlatformAiAction, removePlatformAiAction, savePlatformAiAction, testPlatformAiAction, testPlatformImageAction } from "./actions";

export const metadata: Metadata = { title: "AI" };

const card = "rounded-lg border border-border bg-background p-5";

/**
 * Kaizen's AI provider and models (D73): what every store uses unless its
 * owner brings their own. Changing provider or model here needs no deploy;
 * products are embedded again with a new search model.
 */
export default async function PlatformAiPage() {
  await requirePlatformAdmin();
  const [settings, ownCount] = await Promise.all([getAiSettings(null), countStoresWithOwnAi()]);
  const status = settings
    ? `${settings.enabled ? "On" : "Off"} · ${providerInfo(settings.provider).name}` +
      [settings.embeddingModel, settings.textModel].filter(Boolean).map((model) => ` · ${model}`).join("")
    : "Not set up: stores have keyword search only, unless they bring their own AI.";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">AI</h1>
        <p className="text-sm text-muted">{status}</p>
        <p className="mt-1 text-sm">
          <Link href="/admin/platform/ai/usage" className="underline">
            AI usage
          </Link>
          : what every store and Kaizen itself used, per provider and model.
        </p>
      </div>

      <section aria-labelledby="provider" className={card}>
        <h2 id="provider" className="mb-1 font-medium">Provider and models</h2>
        <p className="mb-4 text-sm text-muted">
          Every store uses these unless its owner chooses their own ({ownCount} {ownCount === 1 ? "store does" : "stores do"}). Keep
          data in the EU where a model allows it, and add any new provider to the residency register before saving it. Shoppers&apos;
          searches are sent to the search model.
        </p>
        <AiProviderForm action={savePlatformAiAction} settings={settings} />
      </section>

      {settings && (
        <section aria-labelledby="test" className={card}>
          <h2 id="test" className="mb-1 font-medium">Test</h2>
          <p className="mb-3 text-sm text-muted">Tries the saved models now, even while off.</p>
          <AiTestButton action={testPlatformAiAction} />
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-sm text-muted">
              Searches such as &ldquo;lampe under 500 kr&rdquo; are read by the text model as filters. This runs the eval: {EVAL_CASES.length} searches in
              Norwegian, Swedish, Danish and English, with the filters a good answer gives; a model passes at {Math.round(PASS_RATE * 100)} %.
            </p>
            <AiEvalButton action={evalPlatformAiAction} />
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-sm text-muted">Makes one small picture with the saved picture model, to see it works and how it looks. It costs one picture.</p>
            <AiImageTestButton action={testPlatformImageAction} />
          </div>
          <div className="mt-4">
            <DeleteDiscountButton
              action={removePlatformAiAction}
              code="Kaizen's AI"
              label="Remove Kaizen's provider"
              question="Remove Kaizen's AI provider and its key? Stores without their own AI keep keyword search only."
            />
          </div>
        </section>
      )}
    </div>
  );
}
