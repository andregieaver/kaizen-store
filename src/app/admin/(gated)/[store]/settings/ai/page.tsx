import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AiEvalButton, AiImageTestButton, AiProviderForm, AiTestButton } from "@/components/admin/ai-provider-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { SettingsMessages } from "@/lib/admin-messages/settings.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { providerInfo } from "@/lib/ai-provider";
import { pictureLine } from "@/lib/ai-vision";
import { EVAL_CASES, PASS_RATE } from "@/lib/query-eval";
import { getAiSettings, type AiSettings } from "@/server/ai";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { checkStoreVisionAction, evalStoreAiAction, removeStoreAiAction, saveStoreAiAction, testStoreAiAction, testStoreImageAction } from "./actions";

export const metadata: Metadata = { title: "AI" };

const card = "rounded-lg border border-line bg-card p-5";

function describe(settings: AiSettings, w: SettingsMessages["ai"]): string {
  const models = [
    settings.embeddingModel && fillWords(w.describe.meaning, { model: settings.embeddingModel }),
    settings.textModel && fillWords(w.describe.text, { model: settings.textModel }),
  ]
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
  const lang = adminLangOf(staffer.account.adminLocale);
  const w = adminText(lang, "settings").ai;
  const usingOwn = own?.enabled === true;
  const current = usingOwn
    ? fillWords(w.yourOwn, { what: describe(own, w) })
    : kaizen?.enabled
      ? fillWords(w.kaizenas, { what: describe(kaizen, w) })
      : w.none;

  return (
    <AdminTextScope texts={adminTexts(lang, ["settings"])}>
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title={w.title} description={<>{current}</>} />
        <p className="text-sm text-muted">{usingOwn ? pictureLine(own, w.yourAi, undefined, w.pictures) : pictureLine(kaizen, w.kaizenaAi, w.chooseOwn, w.pictures)}</p>
        {owner && (
          <p className="mt-1 text-sm">
            <Link href={`/admin/account/usage?store=${store.slug}`} className="underline">
              {w.usage}
            </Link>
            {w.usageEnd}
          </p>
        )}
      </div>

      <section aria-labelledby="about" className={card}>
        <h2 id="about" className="mb-1 text-title text-ink">{w.about}</h2>
        <p className="text-sm">{w.aboutText}</p>
      </section>

      <section aria-labelledby="own" className={card}>
        <h2 id="own" className="mb-1 text-title text-ink">{w.own}</h2>
        {owner ? (
          <>
            <p className="mb-4 text-sm text-muted">{w.ownText}</p>
            <AiProviderForm
              action={saveStoreAiAction.bind(null, store.slug)}
              settings={own}
              submitLabel={own ? adminText(lang, "settings").common.save : w.useOwn}
              checkVision={checkStoreVisionAction.bind(null, store.slug)}
            />
          </>
        ) : (
          <p className="text-sm">{w.onlyOwner}</p>
        )}
      </section>

      {own && owner && (
        <section aria-labelledby="test" className={card}>
          <h2 id="test" className="mb-1 text-title text-ink">{w.test}</h2>
          <p className="mb-3 text-sm text-muted">{w.testText}</p>
          <AiTestButton action={testStoreAiAction.bind(null, store.slug)} />
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm text-muted">{fillWords(w.evalText, { n: EVAL_CASES.length, rate: Math.round(PASS_RATE * 100) })}</p>
            <AiEvalButton action={evalStoreAiAction.bind(null, store.slug)} />
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm text-muted">{w.imageText}</p>
            <AiImageTestButton action={testStoreImageAction.bind(null, store.slug)} />
          </div>
          <div className="mt-4">
            <DeleteDiscountButton
              action={removeStoreAiAction.bind(null, store.slug)}
              code={w.goBackCode}
              label={w.goBack}
              question={w.goBackQuestion}
            />
          </div>
        </section>
      )}
    </div>
    </AdminTextScope>
  );
}
