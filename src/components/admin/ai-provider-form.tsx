"use client";

import { useId, useState, useTransition } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { AI_PROVIDERS, DEFAULT_MIN_SIMILARITY, IMAGE_QUALITIES, providerInfo, type AiProviderId, type ImageQuality } from "@/lib/ai-provider";
import type { VisionCheck } from "@/lib/ai-vision";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

/** A provider's saved settings as the form shows them: never the key. */
export type AiFormSettings = {
  provider: AiProviderId;
  baseUrl: string | null;
  apiKeyHint: string;
  embeddingModel: string | null;
  textModel: string | null;
  visionModel: string | null;
  transcriptionModel: string | null;
  speechModel: string | null;
  speechVoice: string | null;
  imageModel: string | null;
  imageProvider: AiProviderId | null;
  imageBaseUrl: string | null;
  imageApiKeyHint: string | null;
  imageQuality: ImageQuality | null;
  liveModel: string | null;
  liveVoice: string | null;
  liveProvider: AiProviderId | null;
  liveBaseUrl: string | null;
  liveApiKeyHint: string | null;
  minSimilarity: number;
  embeddingEuOnly: boolean;
  textEuOnly: boolean;
  zeroDataRetention: boolean;
  enabled: boolean;
};

const field = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * Chooses an AI provider and its models (D73), for Kaizen or for one store:
 * the same form, given its own save action. Known providers fill in their
 * address; any model the provider offers can be typed.
 */
export function AiProviderForm({
  action,
  settings,
  submitLabel,
  checkVision,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  settings: AiFormSettings | null;
  submitLabel?: string;
  /** Tries a model with the saved provider and key to see whether it looks at pictures (D163); without it the form has no check. */
  checkVision?: (model: string) => Promise<AiVisionCheckResult>;
}) {
  const id = useId();
  const w = useAdminText("settings").ai.form;
  const save = useAdminText("settings").common.save;
  const [provider, setProvider] = useState<AiProviderId>(settings?.provider ?? "gateway");
  const info = providerInfo(provider);
  const saved = settings && settings.provider === provider ? settings : null;
  const keptKey = saved?.apiKeyHint ?? null;
  // Pictures (D92) may come from another provider, with its own key.
  const [imageProvider, setImageProvider] = useState<AiProviderId | "">(settings?.imageProvider ?? "");
  const imageInfo = providerInfo(imageProvider || provider);
  const keptImageKey = settings?.imageProvider && settings.imageProvider === imageProvider ? settings.imageApiKeyHint : null;
  // The live voice (D105) likewise.
  const [liveProvider, setLiveProvider] = useState<AiProviderId | "">(settings?.liveProvider ?? "");
  const liveInfo = providerInfo(liveProvider || provider);
  const keptLiveKey = settings?.liveProvider && settings.liveProvider === liveProvider ? settings.liveApiKeyHint : null;
  const liveSaved = settings && (settings.liveProvider ?? "") === liveProvider;

  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor={`${id}-provider`}>{w.provider}</label>
        <select
          id={`${id}-provider`}
          name="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as AiProviderId)}
          className={field}
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {provider === "custom" && (
        <div className="flex flex-col gap-1 text-sm font-medium">
          <label htmlFor={`${id}-base`}>{w.address}</label>
          <input
            id={`${id}-base`}
            name="baseUrl"
            type="url"
            inputMode="url"
            required
            spellCheck={false}
            defaultValue={settings?.baseUrl ?? ""}
            placeholder="https://api.example.com/v1"
            aria-describedby={`${id}-base-hint`}
            className={`${field} font-mono text-sm`}
          />
          <p id={`${id}-base-hint`} className="font-normal text-muted">
            {w.addressHint}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor={`${id}-key`}>{keptKey ? w.newKey : w.key}</label>
        <input
          id={`${id}-key`}
          name="apiKey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required={!keptKey}
          aria-describedby={`${id}-key-hint`}
          className={`${field} font-mono text-sm`}
        />
        <p id={`${id}-key-hint`} className="font-normal text-muted">
          {keptKey ? fillWords(w.keepKey, { hint: keptKey }) : ""}
          {fillWords(w.keyKept, { provider: info.name })}{" "}
          {info.keysUrl && (
            <a href={info.keysUrl} target="_blank" rel="noreferrer" className="underline">
              {w.whereKey}
            </a>
          )}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ModelField
          key={`embedding-${provider}`}
          id={`${id}-embedding`}
          name="embeddingModel"
          label={w.embedding}
          hint={w.embeddingHint}
          suggestions={info.embeddingModels}
          defaultValue={saved ? (saved.embeddingModel ?? "") : (info.embeddingModels[0] ?? "")}
        />
        <ModelField
          key={`text-${provider}`}
          id={`${id}-text`}
          name="textModel"
          label={w.text}
          hint={w.textHint}
          suggestions={info.textModels}
          defaultValue={saved ? (saved.textModel ?? "") : (info.textModels[0] ?? "")}
        />
      </div>

      <VisionField
        key={`vision-${provider}`}
        id={`${id}-vision`}
        textId={`${id}-text`}
        suggestions={info.visionModels}
        defaultValue={saved ? (saved.visionModel ?? "") : ""}
        check={checkVision ?? null}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.voice}</legend>
        <p className="text-sm text-muted">{w.voiceText}</p>
        <div className="grid gap-5 sm:grid-cols-3">
          <ModelField
            key={`transcription-${provider}`}
            id={`${id}-transcription`}
            name="transcriptionModel"
            label={w.transcription}
            hint={w.transcriptionHint}
            suggestions={info.transcriptionModels}
            defaultValue={saved ? (saved.transcriptionModel ?? "") : ""}
          />
          <ModelField
            key={`speech-${provider}`}
            id={`${id}-speech`}
            name="speechModel"
            label={w.speech}
            hint={w.speechHint}
            suggestions={info.speechModels}
            defaultValue={saved ? (saved.speechModel ?? "") : ""}
          />
          <ModelField
            key={`voice-${provider}`}
            id={`${id}-voice`}
            name="speechVoice"
            label={w.speechVoice}
            hint={w.speechVoiceHint}
            suggestions={info.voices}
            defaultValue={saved ? (saved.speechVoice ?? "") : ""}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.pictures}</legend>
        <p className="text-sm text-muted">{w.picturesText}</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm font-medium">
            <label htmlFor={`${id}-image-provider`}>{w.picturesFrom}</label>
            <select
              id={`${id}-image-provider`}
              name="imageProvider"
              value={imageProvider}
              onChange={(e) => setImageProvider(e.target.value as AiProviderId | "")}
              className={field}
            >
              <option value="">{fillWords(w.providerAbove, { provider: info.name })}</option>
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {fillWords(w.ownKey, { provider: p.name })}
                </option>
              ))}
            </select>
          </div>
          <ModelField
            key={`image-${imageProvider || provider}`}
            id={`${id}-image`}
            name="imageModel"
            label={w.pictureModel}
            hint={w.newestFirst}
            suggestions={imageInfo.imageModels}
            defaultValue={settings && (settings.imageProvider ?? "") === imageProvider ? (settings.imageModel ?? "") : ""}
          />
        </div>
        {imageProvider === "custom" && (
          <div className="flex flex-col gap-1 text-sm font-medium">
            <label htmlFor={`${id}-image-base`}>{w.picturesAddress}</label>
            <input
              id={`${id}-image-base`}
              name="imageBaseUrl"
              type="url"
              inputMode="url"
              required
              spellCheck={false}
              defaultValue={settings?.imageBaseUrl ?? ""}
              placeholder="https://api.example.com/v1"
              className={`${field} font-mono text-sm`}
            />
            <p className="font-normal text-muted">{w.picturesAddressHint}</p>
          </div>
        )}
        {imageProvider && (
          <div className="flex flex-col gap-1 text-sm font-medium">
            <label htmlFor={`${id}-image-key`}>{fillWords(keptImageKey ? w.newKeyFor : w.keyFor, { provider: imageInfo.name })}</label>
            <input
              id={`${id}-image-key`}
              name="imageApiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required={!keptImageKey}
              className={`${field} font-mono text-sm`}
            />
            <p className="font-normal text-muted">
              {keptImageKey ? fillWords(w.keepKey, { hint: keptImageKey }) : ""}
              {fillWords(w.keptFor, { provider: imageInfo.name })}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-1 text-sm font-medium">
          <label htmlFor={`${id}-image-quality`}>{w.quality}</label>
          <select id={`${id}-image-quality`} name="imageQuality" defaultValue={settings?.imageQuality ?? ""} className={`${field} w-fit`}>
            <option value="">{w.qualityNone}</option>
            {(Object.keys(IMAGE_QUALITIES) as ImageQuality[]).map((quality) => (
              <option key={quality} value={quality}>
                {w.qualities[quality]}
              </option>
            ))}
          </select>
          <p className="font-normal text-muted">{w.qualityHint}</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{w.live}</legend>
        <p className="text-sm text-muted">{w.liveText}</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm font-medium">
            <label htmlFor={`${id}-live-provider`}>{w.liveFrom}</label>
            <select
              id={`${id}-live-provider`}
              name="liveProvider"
              value={liveProvider}
              onChange={(e) => setLiveProvider(e.target.value as AiProviderId | "")}
              className={field}
            >
              <option value="">{fillWords(w.providerAbove, { provider: info.name })}</option>
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {fillWords(w.ownKey, { provider: p.name })}
                </option>
              ))}
            </select>
          </div>
          <ModelField
            key={`live-${liveProvider || provider}`}
            id={`${id}-live`}
            name="liveModel"
            label={w.liveModel}
            hint={w.newestFirst}
            suggestions={liveInfo.liveModels}
            defaultValue={liveSaved ? (settings.liveModel ?? "") : ""}
          />
          <ModelField
            key={`live-voice-${liveProvider || provider}`}
            id={`${id}-live-voice`}
            name="liveVoice"
            label={w.liveVoice}
            hint={w.liveVoiceHint}
            suggestions={liveInfo.liveVoices}
            defaultValue={liveSaved ? (settings.liveVoice ?? "") : ""}
          />
        </div>
        {liveProvider === "custom" && (
          <div className="flex flex-col gap-1 text-sm font-medium">
            <label htmlFor={`${id}-live-base`}>{w.liveAddress}</label>
            <input
              id={`${id}-live-base`}
              name="liveBaseUrl"
              type="url"
              inputMode="url"
              required
              spellCheck={false}
              defaultValue={settings?.liveBaseUrl ?? ""}
              placeholder="https://api.example.com/v1"
              className={`${field} font-mono text-sm`}
            />
            <p className="font-normal text-muted">{w.liveAddressHint}</p>
          </div>
        )}
        {liveProvider && (
          <div className="flex flex-col gap-1 text-sm font-medium">
            <label htmlFor={`${id}-live-key`}>{fillWords(keptLiveKey ? w.newKeyFor : w.keyFor, { provider: liveInfo.name })}</label>
            <input
              id={`${id}-live-key`}
              name="liveApiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required={!keptLiveKey}
              className={`${field} font-mono text-sm`}
            />
            <p className="font-normal text-muted">
              {keptLiveKey ? fillWords(w.keepKey, { hint: keptLiveKey }) : ""}
              {fillWords(w.keptFor, { provider: liveInfo.name })}
            </p>
          </div>
        )}
      </fieldset>

      {/* Hidden rather than left out for other providers, so switching back keeps them. */}
      <fieldset hidden={!info.gateway} className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.where}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="embeddingEuOnly" defaultChecked={settings?.embeddingEuOnly ?? false} className="mt-0.5 size-4" />
          <span>
            {w.embeddingEu}
            <span className="block text-xs text-muted">{w.embeddingEuHint}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="textEuOnly" defaultChecked={settings?.textEuOnly ?? true} className="mt-0.5 size-4" />
          <span>
            {w.textEu}
            <span className="block text-xs text-muted">{w.textEuHint}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="zeroDataRetention" defaultChecked={settings?.zeroDataRetention ?? true} className="mt-0.5 size-4" />
          <span>
            {w.zdr}
            <span className="block text-xs text-muted">{w.zdrHint}</span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor={`${id}-similarity`}>{w.similarity}</label>
        <input
          id={`${id}-similarity`}
          name="minSimilarity"
          type="number"
          inputMode="decimal"
          min={0}
          max={1}
          step={0.01}
          required
          defaultValue={settings?.minSimilarity ?? DEFAULT_MIN_SIMILARITY}
          aria-describedby={`${id}-similarity-hint`}
          className={`${field} w-32`}
        />
        <p id={`${id}-similarity-hint`} className="font-normal text-muted">
          {w.similarityHint}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? true} className="size-4" />
        {w.on}
      </label>

      <div>
        <SubmitButton>{submitLabel ?? save}</SubmitButton>
      </div>
    </ActionForm>
  );
}

function ModelField({
  id,
  name,
  label,
  hint,
  suggestions,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  suggestions: string[];
  defaultValue: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        list={suggestions.length > 0 ? `${id}-list` : undefined}
        autoComplete="off"
        spellCheck={false}
        defaultValue={defaultValue}
        aria-describedby={`${id}-hint`}
        className={`${field} font-mono text-sm`}
      />
      {suggestions.length > 0 && (
        <datalist id={`${id}-list`}>
          {suggestions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      )}
      <p id={`${id}-hint`} className="font-normal text-muted">
        {hint}
      </p>
    </div>
  );
}

export type AiVisionCheckResult = VisionCheck;

/**
 * The model that looks at pictures (D163): copying a page and writing alt texts send it pictures. Suggestions are one press each; any name
 * can be typed; and "Check that it sees pictures" sends the model a small picture of two coloured bands and asks which colours they are,
 * so a model that cannot see (or only guesses) is found out before anything relies on it. Empty uses the text model.
 */
function VisionField({
  id,
  textId,
  suggestions,
  defaultValue,
  check,
}: {
  id: string;
  textId: string;
  suggestions: { model: string; note: string }[];
  defaultValue: string;
  check: ((model: string) => Promise<AiVisionCheckResult>) | null;
}) {
  const w = useAdminText("settings").ai.form;
  const [value, setValue] = useState(defaultValue);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AiVisionCheckResult | null>(null);
  const change = (next: string) => {
    setValue(next);
    setResult(null);
  };
  // Empty checks the text model, which is what would be used.
  const checked = () => value.trim() || (document.getElementById(textId) as HTMLInputElement | null)?.value.trim() || "";
  return (
    <div id="vision" className="flex scroll-mt-20 flex-col gap-2 rounded-panel border border-line p-4 text-sm">
      <label htmlFor={id} className="font-medium">
        {w.vision}
      </label>
      <p className="text-muted">{w.visionText}</p>
      <input
        id={id}
        name="visionModel"
        value={value}
        onChange={(e) => change(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder={w.visionPlaceholder}
        className={`${field} font-mono text-sm`}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={w.visionSuggestions}>
          {suggestions.map((s) => (
            <button
              key={s.model}
              type="button"
              aria-pressed={value === s.model}
              onClick={() => change(s.model)}
              className={`min-h-9 rounded-pill border px-3 text-left ${value === s.model ? "border-brand bg-sunken" : "border-edge hover:bg-sunken"}`}
            >
              <span className="font-mono text-xs">{s.model}</span>
              <span className="ml-2 text-muted">{s.note}</span>
            </button>
          ))}
        </div>
      )}
      {check && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setResult(await check(checked())))}
            className="min-h-10 w-fit rounded-pill border border-edge px-4 font-medium hover:bg-sunken disabled:opacity-50"
          >
            {pending ? w.looking : w.checkVision}
          </button>
          <p className="text-muted">{w.checkVisionHint}</p>
          <p role="status" className={result && !result.ok ? "text-danger-text" : ""}>
            {result?.ok && fillWords(w.sees, { model: result.model, s: (result.ms / 1000).toFixed(1) })}
            {result && !result.ok && `✗ ${result.message}`}
          </p>
        </div>
      )}
    </div>
  );
}

export type AiTestResult = { embedding: { ok: boolean; message: string } | null; text: { ok: boolean; message: string } | null } | { error: string };

/** Tries the saved models now and says how each went. */
export function AiTestButton({ action }: { action: () => Promise<AiTestResult> }) {
  const w = useAdminText("settings").ai.form;
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AiTestResult | null>(null);
  const lines =
    result && "error" in result
      ? [{ ok: false, message: result.error }]
      : result
        ? [result.embedding, result.text].filter((part): part is { ok: boolean; message: string } => part !== null)
        : [];
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await action()))}
        className="min-h-10 w-fit rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken disabled:opacity-50"
      >
        {pending ? w.testing : w.test}
      </button>
      <ul role="status" className="flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <li key={line.message} className={line.ok ? "" : "text-danger-text"}>
            {line.ok ? "✓ " : "✗ "}
            {line.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type AiEvalResult =
  | { model: string; passed: number; total: number; ok: boolean; ms: number; failures: { query: string; problems: string[]; answer?: string }[] }
  | { error: string };

/** Runs the query-understanding eval against the saved text model and shows how it did (D75). */
export function AiEvalButton({ action }: { action: () => Promise<AiEvalResult> }) {
  const w = useAdminText("settings").ai.form;
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AiEvalResult | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await action()))}
        className="min-h-10 w-fit rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken disabled:opacity-50"
      >
        {pending ? w.checking : w.checkUnderstanding}
      </button>
      <div role="status" className="text-sm">
        {result && "error" in result && <p className="text-danger-text">✗ {result.error}</p>}
        {result && !("error" in result) && (
          <>
            <p className={result.ok ? "" : "text-danger-text"}>
              {result.ok ? w.passes : w.fails}
              {fillWords(w.understood, {
                model: result.model,
                passed: result.passed,
                total: result.total,
                share: Math.round((result.passed / result.total) * 100),
                s: (result.ms / 1000).toFixed(1),
              })}
            </p>
            {result.failures.length > 0 && (
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {result.failures.map((failure) => (
                  <li key={failure.query}>
                    <span className="font-medium">“{failure.query}”</span>: {failure.problems.join("; ")}
                    {failure.answer && (
                      <code className="mt-0.5 block break-all text-xs text-muted">{fillWords(w.answered, { answer: failure.answer })}</code>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export type AiImageTestResult = { ok: true; dataUrl: string; ms: number } | { ok: false; message: string };

/** Makes one small test picture with the saved picture model and shows it (not kept). */
export function AiImageTestButton({ action }: { action: () => Promise<AiImageTestResult> }) {
  const w = useAdminText("settings").ai.form;
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AiImageTestResult | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await action()))}
        className="min-h-10 w-fit rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken disabled:opacity-50"
      >
        {pending ? w.making : w.testPicture}
      </button>
      <div role="status" className="text-sm">
        {result && !result.ok && <p className="text-danger-text">✗ {result.message}</p>}
        {result?.ok && (
          <div className="flex flex-col gap-2">
            <p>{fillWords(w.made, { s: (result.ms / 1000).toFixed(1) })}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a small test picture, never kept */}
            <img src={result.dataUrl} alt={w.testAlt} width={256} height={256} className="rounded-md border border-line" />
          </div>
        )}
      </div>
    </div>
  );
}
