import type { Metadata } from "next";
import Link from "next/link";

import { AiEvalButton, AiImageTestButton, AiProviderForm, AiTestButton } from "@/components/admin/ai-provider-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { providerInfo } from "@/lib/ai-provider";
import { pictureLine } from "@/lib/ai-vision";
import { EVAL_CASES, PASS_RATE } from "@/lib/query-eval";
import { AGENT_EVAL_CASES } from "@/lib/agent-eval";
import { AgentEvalButton } from "@/components/admin/agent-eval-button";
import { recentAgentEvalRuns } from "@/server/agent-eval";
import { countStoresWithOwnAi, getAiSettings } from "@/server/ai";
import { requirePlatformAdmin } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { checkPlatformVisionAction, evalPlatformAiAction, evalPlatformAgentsAction, removePlatformAiAction, savePlatformAiAction, testPlatformAiAction, testPlatformImageAction } from "./actions";

/** The evals run in this page's actions and take up to a few minutes (PSI 2026-10-24, AST-09). */
export const maxDuration = 300;

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
  const agentRuns = await recentAgentEvalRuns();
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
            <p className="mb-2 text-sm text-muted">{fillWords(shared.agentsText, { n: AGENT_EVAL_CASES.length })}</p>
            <AgentEvalButton action={evalPlatformAgentsAction} />
            {agentRuns.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="text-muted">{shared.agentsRuns}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {agentRuns.map((run) => (
                    <li key={run.ranAt} className={run.passed < run.total ? "text-danger-text" : "text-ink-2"}>
                      {fillWords(shared.agentsRun, { date: run.ranAt.slice(0, 16).replace("T", " "), model: run.model, passed: run.passed, total: run.total })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
