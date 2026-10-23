import type { Metadata } from "next";
import Link from "next/link";

import { AiEvalButton, AiImageTestButton, AiProviderForm, AiTestButton } from "@/components/admin/ai-provider-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { providerInfo } from "@/lib/ai-provider";
import { pictureLine } from "@/lib/ai-vision";
import { EVAL_CASES, PASS_RATE } from "@/lib/query-eval";
import { countStoresWithOwnAi, getAiSettings } from "@/server/ai";
import { requirePlatformAdmin } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { checkPlatformVisionAction, evalPlatformAiAction, removePlatformAiAction, savePlatformAiAction, testPlatformAiAction, testPlatformImageAction } from "./actions";

export const metadata: Metadata = { title: "AI" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * Kaizen's AI provider and models (D73): what every store uses unless its
 * owner brings their own. Changing provider or model here needs no deploy;
 * products are embedded again with a new search model.
 */
export default async function PlatformAiPage() {
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platformTools").ai;
  const shared = adminText(lang, "settings").ai;
  const [settings, ownCount] = await Promise.all([getAiSettings(null), countStoresWithOwnAi()]);
  const status = settings
    ? `${settings.enabled ? w.on : w.off} · ${providerInfo(settings.provider).name}` +
      [settings.embeddingModel, settings.textModel].filter(Boolean).map((model) => ` · ${model}`).join("")
    : w.notSetUp;

  return (
    <AdminTextScope texts={adminTexts(lang, ["settings"])}>
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title={w.title} description={<>{status}</>} />
        <p className="text-sm text-muted">{pictureLine(settings, w.whose, undefined, shared.pictures)}</p>
        <p className="mt-1 text-sm">
          <Link href="/admin/platform/ai/usage" className="underline">
            {w.usageLink}
          </Link>
          {w.usageEnd}
        </p>
      </div>

      <section aria-labelledby="provider" className={card}>
        <h2 id="provider" className="mb-1 text-title text-ink">{w.provider}</h2>
        <p className="mb-4 text-sm text-muted">{fillWords(w.providerText, { count: countWords(ownCount, { one: w.storeDoes, many: w.storesDo }) })}</p>
        <AiProviderForm action={savePlatformAiAction} settings={settings} checkVision={checkPlatformVisionAction} />
      </section>

      {settings && (
        <section aria-labelledby="test" className={card}>
          <h2 id="test" className="mb-1 text-title text-ink">{w.test}</h2>
          <p className="mb-3 text-sm text-muted">{w.testText}</p>
          <AiTestButton action={testPlatformAiAction} />
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm text-muted">{fillWords(shared.evalText, { n: EVAL_CASES.length, rate: Math.round(PASS_RATE * 100) })}</p>
            <AiEvalButton action={evalPlatformAiAction} />
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm text-muted">{shared.imageText}</p>
            <AiImageTestButton action={testPlatformImageAction} />
          </div>
          <div className="mt-4">
            <DeleteDiscountButton
              action={removePlatformAiAction}
              code={w.removeCode}
              label={w.remove}
              question={w.removeQuestion}
            />
          </div>
        </section>
      )}
    </div>
    </AdminTextScope>
  );
}
