"use client";

import { useId, useState, useTransition } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { AI_PROVIDERS, DEFAULT_MIN_SIMILARITY, providerInfo, type AiProviderId } from "@/lib/ai-provider";

/** A provider's saved settings as the form shows them: never the key. */
export type AiFormSettings = {
  provider: AiProviderId;
  baseUrl: string | null;
  apiKeyHint: string;
  embeddingModel: string | null;
  textModel: string | null;
  minSimilarity: number;
  embeddingEuOnly: boolean;
  textEuOnly: boolean;
  zeroDataRetention: boolean;
  enabled: boolean;
};

const field = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/**
 * Chooses an AI provider and its models (D73), for Kaizen or for one store:
 * the same form, given its own save action. Known providers fill in their
 * address; any model the provider offers can be typed.
 */
export function AiProviderForm({
  action,
  settings,
  submitLabel = "Save",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  settings: AiFormSettings | null;
  submitLabel?: string;
}) {
  const id = useId();
  const [provider, setProvider] = useState<AiProviderId>(settings?.provider ?? "gateway");
  const info = providerInfo(provider);
  const saved = settings && settings.provider === provider ? settings : null;
  const keptKey = saved?.apiKeyHint ?? null;

  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor={`${id}-provider`}>Provider</label>
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
          <label htmlFor={`${id}-base`}>API address</label>
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
            An OpenAI-compatible API: Kaizen adds /embeddings and /chat/completions to this address.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor={`${id}-key`}>{keptKey ? "New API key" : "API key"}</label>
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
          {keptKey ? `Leave empty to keep the saved key (${keptKey}). ` : ""}
          The key is kept encrypted and only ever sent to {info.name}.{" "}
          {info.keysUrl && (
            <a href={info.keysUrl} target="_blank" rel="noreferrer" className="underline">
              Where to get a key
            </a>
          )}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ModelField
          key={`embedding-${provider}`}
          id={`${id}-embedding`}
          name="embeddingModel"
          label="Model for search by meaning"
          hint="Turns products and searches into vectors. Empty: keyword search only."
          suggestions={info.embeddingModels}
          defaultValue={saved ? (saved.embeddingModel ?? "") : (info.embeddingModels[0] ?? "")}
        />
        <ModelField
          key={`text-${provider}`}
          id={`${id}-text`}
          name="textModel"
          label="Model for text"
          hint="Understands searches and writes product texts for staff to approve. Empty: off."
          suggestions={info.textModels}
          defaultValue={saved ? (saved.textModel ?? "") : (info.textModels[0] ?? "")}
        />
      </div>

      {/* Hidden rather than left out for other providers, so switching back keeps them. */}
      <fieldset hidden={!info.gateway} className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Where requests run</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="embeddingEuOnly" defaultChecked={settings?.embeddingEuOnly ?? false} className="mt-0.5 size-4" />
          <span>
            Search model only in EU data centres
            <span className="block text-xs text-muted">No embedding model can be pinned to the EU yet: requests would fail.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="textEuOnly" defaultChecked={settings?.textEuOnly ?? true} className="mt-0.5 size-4" />
          <span>
            Text model only in EU data centres
            <span className="block text-xs text-muted">A request fails rather than run elsewhere, and search carries on without it.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="zeroDataRetention" defaultChecked={settings?.zeroDataRetention ?? true} className="mt-0.5 size-4" />
          <span>
            Only providers that keep nothing
            <span className="block text-xs text-muted">Zero data retention: prompts and answers are deleted after each request.</span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col gap-1 text-sm font-medium">
        <label htmlFor={`${id}-similarity`}>Similarity needed for search by meaning</label>
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
          From 0 to 1. Products less like the search than this are not found by meaning. Each model scores differently: Test
          shows a matching and an unrelated product&apos;s scores, and the limit belongs between them.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? true} className="size-4" />
        On
      </label>

      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
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

export type AiTestResult = { embedding: { ok: boolean; message: string } | null; text: { ok: boolean; message: string } | null } | { error: string };

/** Tries the saved models now and says how each went. */
export function AiTestButton({ action }: { action: () => Promise<AiTestResult> }) {
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
        className="min-h-10 w-fit rounded-md border border-border px-4 text-sm font-medium hover:bg-surface disabled:opacity-50"
      >
        {pending ? "Testing …" : "Test"}
      </button>
      <ul role="status" className="flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <li key={line.message} className={line.ok ? "" : "text-red-700 dark:text-red-400"}>
            {line.ok ? "✓ " : "✗ "}
            {line.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
