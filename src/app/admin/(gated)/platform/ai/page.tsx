import type { Metadata } from "next";
import Link from "next/link";

import { AiEvalButton, AiImageTestButton, AiProviderForm, AiTestButton } from "@/components/admin/ai-provider-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { providerInfo } from "@/lib/ai-provider";
import { pictureLine, visionModelOf } from "@/lib/ai-vision";
import { EVAL_CASES, PASS_RATE } from "@/lib/query-eval";
import { AGENT_EVAL_CASES, samePrompts, versionWords } from "@/lib/agent-eval";
import { AgentEvalButton } from "@/components/admin/agent-eval-button";
import { managerRatingsByVersion, promptVersions, recentAgentEvalRuns } from "@/server/agent-eval";
import { stepsOf } from "@/lib/dream-factory";
import { recentDreamRuns } from "@/server/dream-factory";
import { countStoresWithOwnAi, getAiSettings } from "@/server/ai";
import { aiAutonomyPaused } from "@/server/ai-pause";
import { requirePlatformReader } from "@/server/auth";
import { searchSettings } from "@/server/web-search-settings";
import { SEARCH_API_IDS, SEARCH_APIS } from "@/lib/web-search";
import { ActionForm } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { Button } from "@/components/admin/ui";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { checkPlatformVisionAction, evalPlatformAiAction, setAiPauseAction, evalPlatformAgentsAction, removePlatformAiAction, savePlatformAiAction, saveWebSearchAction, testPlatformAiAction, testPlatformImageAction } from "./actions";

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
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platformTools").ai;
  const shared = adminText(lang, "settings").ai;
  const [agentRuns, dreamRuns, ratings] = await Promise.all([recentAgentEvalRuns(), recentDreamRuns(), managerRatingsByVersion()]);
  const current = promptVersions();
  const [settings, ownCount, search, paused] = await Promise.all([getAiSettings(null), countStoresWithOwnAi(), searchSettings(), aiAutonomyPaused()]);
  const status = settings
    ? `${settings.enabled ? w.on : w.off} · ${providerInfo(settings.provider).name}` +
      [settings.embeddingModel, settings.textModel].filter(Boolean).map((model) => ` · ${model}`).join("")
    : w.notSetUp;
  const ph = w.phone;
  const row = { change: ph.change, done: ph.close } as const;
  const onOff = (on: boolean) => (on ? w.on : w.off);
  const searchName = SEARCH_APIS[search?.provider ?? SEARCH_API_IDS[0]].name;
  const seesPictures = Boolean(settings?.enabled && visionModelOf(settings));
  const pauseForm = (
    <ActionForm action={setAiPauseAction}>
      <input type="hidden" name="paused" value={paused ? "off" : "on"} />
      <Button type="submit" kind={paused ? "main" : "secondary"}>{paused ? w.pause.resumeButton : w.pause.pauseButton}</Button>
    </ActionForm>
  );

  return (
    <AdminTextScope texts={adminTexts(lang, ["settingsAi"])}>
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title={w.title} description={<>{status}</>} />
        <p className="text-sm text-muted max-sm:hidden">{pictureLine(settings, w.whose, undefined, shared.pictures)}</p>
        <p className="mt-1 text-sm">
          <Link href="/admin/platform/ai/usage" className="underline">
            {w.usageLink}
          </Link>
          <span className="max-sm:hidden">{w.usageEnd}</span>
        </p>
      </div>
      {/* Round 67 (D837): on a phone the pictures warning is a strip that opens the provider's row; from sm up the line above says it. */}
      {!seesPictures && (
        <p className="flex items-center justify-between gap-3 rounded-panel bg-warning-soft px-4 py-3 text-body text-ink sm:hidden">
          {ph.noPictures}
          <a href="#provider" className="inline-flex min-h-10 shrink-0 items-center underline underline-offset-2">
            {ph.choose}
          </a>
        </p>
      )}

      {/* Round 67 (D837): on a phone what acts on its own is a row with its one press, and each setting below a row saying what is set. */}
      <PhoneRows>
      <PhoneRow flat last {...row} change={ph.more} title={w.pause.title} sub={paused ? ph.paused : ph.running} action={pauseForm}>
      <section aria-labelledby="ai-pause" className={card}>
        <h2 id="ai-pause" className="mb-1 text-title text-ink">{w.pause.title}</h2>
        <p className="mb-4 text-sm text-muted">{paused ? w.pause.paused : w.pause.running}</p>
        {pauseForm}
      </section>
      </PhoneRow>
      </PhoneRows>

      <PhoneRows>
      <PhoneRow flat {...row} opens="provider" title={w.provider} sub={settings ? `${providerInfo(settings.provider).name} · ${onOff(settings.enabled)}` : ph.notSet}>
      <section aria-labelledby="provider" className={card}>
        <h2 id="provider" className="mb-1 text-title text-ink">{w.provider}</h2>
        <p className="mb-4 text-sm text-muted">{fillWords(w.providerText, { count: countWords(ownCount, { one: w.storeDoes, many: w.storesDo }) })}</p>
        <AiProviderForm action={savePlatformAiAction} settings={settings} checkVision={checkPlatformVisionAction} />
      </section>
      </PhoneRow>

      <PhoneRow flat {...row} title={w.webSearch} sub={search ? `${searchName} · ${onOff(search.enabled)}` : `${searchName} · ${ph.noKey}`}>
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
              {/* At least 24 px high (WCAG 2.5.8): before a key is saved it stands alone under the field, not inside a sentence. */}
              <a
                href={SEARCH_APIS[search?.provider ?? SEARCH_API_IDS[0]].keyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-6 items-center underline underline-offset-2"
              >
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
      </PhoneRow>

      {settings && (
        <PhoneRow flat {...row} change={ph.more} title={w.test} sub={ph.testSub}>
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
                      {fillWords(shared.agentsRun, { date: adminDate(PLATFORM_TIME_ZONE, run.ranAt, "dayTime", lang), model: run.model, passed: run.passed, total: run.total })}
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
            {/* The owners' thumbs as labels, per prompt version (PSI AGT-14): counts only. */}
            <div className="mt-3 text-sm">
              <p className="text-muted">{shared.ratingsTitle}</p>
              {ratings.length === 0 ? (
                <p className="mt-1 text-ink-2">{shared.ratingsNone}</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {ratings.map((r) => (
                    <li key={r.version} className="text-ink-2">
                      {fillWords(shared.ratingsRow, { version: r.version, up: r.up, down: r.down, rated: r.up + r.down, share: `${Math.round((r.up * 100) / Math.max(1, r.up + r.down))} %` })}
                      {r.version === current.manager && <span className="text-muted"> · {shared.ratingsNow}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">{shared.ratingsHelp}</p>
            </div>
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
        </PhoneRow>
      )}
      {/* The Dream Factory's scorecard (D409): each run's measures, worked out by code. */}
      <PhoneRow flat last {...row} change={ph.more} title={w.dreamTitle} sub={dreamRuns.length === 0 ? w.dreamNone : countWords(dreamRuns.length, ph.runs)}>
      <section className={card}>
        <h2 className="text-title text-ink">{w.dreamTitle}</h2>
        <p className="mt-1 text-sm text-muted">
          {w.dreamText}{" "}
          <Link href="/admin/stores" className="underline">
            {w.dreamStart}
          </Link>
        </p>
        {dreamRuns.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{w.dreamNone}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {dreamRuns.map((run) => (
              <li key={run.id} className={run.status === "failed" ? "text-danger-text" : "text-ink-2"}>
                {/* A test run is watched here (D419): its store belongs to the test address, so its own page is not a platform admin's. */}
                <Link href={run.test && run.kind === "build" ? `/admin/platform/ai/dream/${run.id}` : `/admin/${run.storeSlug}/dream-factory`} className="underline">
                  {fillWords(w.dreamRun, {
                    date: adminDate(PLATFORM_TIME_ZONE, run.createdAt, "dayTime", lang),
                    store: run.storeName,
                    status: run.status,
                    done: run.score.done,
                    total: stepsOf(run.kind).length,
                    minutes: run.score.minutesToReady ?? "–",
                    presses: run.score.ownerPresses,
                    first: run.score.firstTryPercent === null ? "–" : `${run.score.firstTryPercent} %`,
                  })}
                </Link>
                {run.test && <span className="text-muted"> · {w.dreamTest}</span>}
                {run.kind === "rework" && <span className="text-muted"> · {w.dreamRework}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      </PhoneRow>
      </PhoneRows>
    </div>
    </AdminTextScope>
  );
}

