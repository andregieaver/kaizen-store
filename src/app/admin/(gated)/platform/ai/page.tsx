import type { Metadata } from "next";
import Link from "next/link";

import { AiEvalButton, AiImageTestButton, AiProviderForm, AiTestButton } from "@/components/admin/ai-provider-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { providerInfo } from "@/lib/ai-provider";
import { pictureLine } from "@/lib/ai-vision";
import { EVAL_CASES, PASS_RATE } from "@/lib/query-eval";
import { AGENT_EVAL_CASES, samePrompts, versionWords } from "@/lib/agent-eval";
import { AgentEvalButton } from "@/components/admin/agent-eval-button";
import { promptVersions, recentAgentEvalRuns } from "@/server/agent-eval";
import { recentDreamRuns } from "@/server/dream-factory";
import { countStoresWithOwnAi, getAiSettings } from "@/server/ai";
import { requirePlatformAdmin } from "@/server/auth";
import { searchSettings } from "@/server/web-search-settings";
import { SEARCH_API_IDS, SEARCH_APIS } from "@/lib/web-search";
import { ActionForm } from "@/components/admin/action-form";
import { Button } from "@/components/admin/ui";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { checkPlatformVisionAction, evalPlatformAiAction, evalPlatformAgentsAction, removePlatformAiAction, savePlatformAiAction, saveWebSearchAction, testPlatformAiAction, testPlatformImageAction } from "./actions";

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
  const [agentRuns, dreamRuns] = await Promise.all([recentAgentEvalRuns(), recentDreamRuns()]);
  const current = promptVersions();
  const [settings, ownCount, search] = await Promise.all([getAiSettings(null), countStoresWithOwnAi(), searchSettings()]);
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

      <section aria-labelledby="web-search" className={card}>
        <h2 id="web-search" className="mb-1 text-title text-ink">{w.webSearch}</h2>
        <p className="mb-1 text-sm text-muted">{fillWords(w.webSearchText, { provider: search?.provider ?? SEARCH_API_IDS[0] })}</p>
        <p className="mb-4 text-sm text-muted">{search ? (search.enabled ? w.on : w.off) : w.webSearchNone}</p>
        <ActionForm action={saveWebSearchAction} successMessage={w.webSearchSaved} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            {w.webSearchService}
            <select name="provider" defaultValue={search?.provider ?? SEARCH_API_IDS[0]} className="min-h-10 max-w-72 rounded-lg border border-edge bg-card px-3 text-sm">
              {SEARCH_API_IDS.map((id) => (
                <option key={id} value={id}>
                  {SEARCH_APIS[id].name}
                </option>
              ))}
            </select>
            <span className="text-caption text-muted">{w.webSearchWhere}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.webSearchKey}
            <input name="api_key" type="password" autoComplete="off" className="min-h-10 max-w-96 rounded-lg border border-edge bg-card px-3 text-sm" />
            <span className="text-caption text-muted">
              {search ? fillWords(w.webSearchKeySaved, { hint: search.keyHint }) : null}{" "}
              <a href={SEARCH_APIS[search?.provider ?? SEARCH_API_IDS[0]].keyUrl} target="_blank" rel="noreferrer" className="underline">
                {w.webSearchGetKey}
              </a>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={search?.enabled ?? true} />
            {w.webSearchOn}
          </label>
          <div>
            <Button type="submit" kind="main">
              {w.webSearchSave}
            </Button>
          </div>
        </ActionForm>
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
                    <li key={run.id} className={run.passed < run.total ? "text-danger-text" : "text-ink-2"}>
                      {fillWords(shared.agentsRun, { date: run.ranAt.slice(0, 16).replace("T", " "), model: run.model, passed: run.passed, total: run.total })}
                      {run.prompts && (
                        <span className="text-muted">
                          {" · "}
                          {fillWords(samePrompts(run.prompts, current) ? shared.agentsPromptsNow : shared.agentsPromptsOld, { versions: versionWords(run.prompts) })}
                        </span>
                      )}
                      {run.recorded && (
                        <>
                          {" · "}
                          <a href={`/admin/platform/ai/eval/${run.id}/recording`} download className="underline">
                            {shared.agentsDownload}
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">{fillWords(shared.agentsRecordingHelp, { versions: versionWords(current) })}</p>
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
      {/* The Dream Factory's scorecard (D409): each run's measures, worked out by code. */}
      <section className={card}>
        <h2 className="text-title text-ink">{w.dreamTitle}</h2>
        <p className="mt-1 text-sm text-muted">{w.dreamText}</p>
        {dreamRuns.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{w.dreamNone}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {dreamRuns.map((run) => (
              <li key={run.id} className={run.status === "failed" ? "text-danger-text" : "text-ink-2"}>
                <span>
                  {fillWords(w.dreamRun, {
                    date: run.createdAt.toISOString().slice(0, 16).replace("T", " "),
                    store: run.storeName,
                    status: run.status,
                    done: run.score.done,
                    minutes: run.score.minutesToReady ?? "–",
                    presses: run.score.ownerPresses,
                    first: run.score.firstTryPercent === null ? "–" : `${run.score.firstTryPercent} %`,
                  })}
                </span>
                {run.test && <span className="text-muted"> · {w.dreamTest}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </AdminTextScope>
  );
}

