"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminText } from "./admin-text";
import { Button } from "./ui";

type Shown = { clientId: string; secret?: string; webhookSecret?: string };
type Answer = { ok: true; id: string; shown?: Shown } | { ok: false; problems: Record<string, string> };

/** An app's form as it stands (empty for a new one). */
export type AppFormValues = {
  name: string;
  description: string;
  logoUrl: string;
  homepageUrl: string;
  privacyUrl: string;
  supportEmail: string;
  redirectUris: string[];
  scopes: string[];
  distribution: string;
  webhookUrl: string;
  /** The events address the app has, shown by its host (it is kept encrypted): an empty field keeps it. */
  webhookHint: string | null;
  webhookTopics: string[];
};

type Choice = { value: string; label: string; hint?: string };

const field = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** What was shown once: the client ID with a secret, an events secret, or both; copied, then gone for good. */
function ShownOnce({ shown, onDone }: { shown: Shown; onDone: () => void }) {
  const w = useAdminText("oauth").developer.credentials;
  const [copied, setCopied] = useState<string | null>(null);
  const rows = [
    { key: "client", label: w.clientId, value: shown.clientId },
    ...(shown.secret ? [{ key: "secret", label: w.secret, value: shown.secret }] : []),
    ...(shown.webhookSecret ? [{ key: "events", label: w.eventsSecret, value: shown.webhookSecret }] : []),
  ];
  return (
    <div role="status" className="flex flex-col gap-3 rounded-panel border border-warning-line bg-warning-soft p-4 text-sm">
      <p className="text-ink-2">{w.once}</p>
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-1">
          <span className="text-body-strong text-ink">{row.label}</span>
          <code className="break-all rounded-panel bg-card px-3 py-2 font-mono text-xs text-ink">{row.value}</code>
          <div>
            <Button kind="quiet" onClick={() => void navigator.clipboard?.writeText(row.value).then(() => setCopied(row.key))}>
              {copied === row.key ? w.copied : w.copy}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button onClick={onDone}>{w.done}</Button>
      </div>
    </div>
  );
}

/**
 * An app's form (D441): Homer fills in the name, what it does, its redirect URIs and what it needs; the powers, the events and the
 * addresses wait under their own folds. A new app's client ID and secrets are shown once after it is made, then the app's page opens.
 */
export function AppForm({
  initial,
  scopes,
  powers,
  topics,
  distributions,
  save,
  isNew,
}: {
  initial: AppFormValues;
  scopes: Choice[];
  powers: Choice[];
  topics: Choice[];
  distributions: Choice[];
  save: (form: FormData) => Promise<Answer>;
  isNew: boolean;
}) {
  const w = useAdminText("oauth").developer;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [shown, setShown] = useState<{ id: string; shown: Shown } | null>(null);
  if (shown) return <ShownOnce shown={shown.shown} onDone={() => router.push(`/admin/account/developer/${shown.id}`)} />;
  const problem = (name: string) =>
    problems[name] ? (
      <span role="alert" className="text-sm font-normal text-danger-text">
        {problems[name]}
      </span>
    ) : null;
  return (
    <form
      aria-busy={pending}
      className="flex flex-col gap-5"
      action={(form) =>
        start(async () => {
          const answer = await save(form);
          if (!answer.ok) {
            setProblems(answer.problems);
            setSaved(false);
            return;
          }
          setProblems({});
          if (answer.shown?.secret || answer.shown?.webhookSecret) setShown({ id: answer.id, shown: answer.shown });
          else setSaved(true);
        })
      }
    >
      {problem("form")}
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.form.name}
        <input name="name" required maxLength={60} defaultValue={initial.name} className={field} />
        {problem("name")}
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.form.description}
        <textarea name="description" maxLength={500} rows={3} defaultValue={initial.description} className={`${field} py-2`} />
        <span className="text-xs font-normal text-muted">{w.form.descriptionHint}</span>
        {problem("description")}
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.form.redirects}
        <textarea name="redirect_uris" required rows={2} defaultValue={initial.redirectUris.join("\n")} className={`${field} py-2 font-mono text-xs`} />
        <span className="text-xs font-normal text-muted">{w.form.redirectsHint}</span>
        {problem("redirect_uris")}
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.form.scopes}</legend>
        <p className="text-xs text-muted">{w.form.scopesHint}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {scopes.map((scope) => (
            <label key={scope.value} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="scopes" value={scope.value} defaultChecked={initial.scopes.includes(scope.value)} className="mt-0.5 size-4" />
              <span>
                {scope.label}
                <code className="block text-xs text-muted">{scope.value}</code>
              </span>
            </label>
          ))}
        </div>
        {problem("scopes")}
      </fieldset>
      <details className="rounded-panel border border-line p-3" open={powers.some((p) => initial.scopes.includes(p.value))}>
        <summary className="cursor-pointer text-sm font-medium">{w.form.powers}</summary>
        <p className="mt-2 text-xs text-muted">{w.form.powersHint}</p>
        <div className="mt-2 grid gap-2">
          {powers.map((power) => (
            <label key={power.value} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="scopes" value={power.value} defaultChecked={initial.scopes.includes(power.value)} className="mt-0.5 size-4" />
              <span>
                {power.label}
                <code className="block text-xs text-muted">{power.value}</code>
              </span>
            </label>
          ))}
        </div>
      </details>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.form.distribution}</legend>
        {distributions.map((d) => (
          <label key={d.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="distribution" value={d.value} defaultChecked={initial.distribution === d.value} className="mt-0.5 size-4" />
            <span>{d.label}</span>
          </label>
        ))}
        {problem("distribution")}
      </fieldset>
      <details className="rounded-panel border border-line p-3" open={Boolean(initial.webhookHint) || Boolean(problems.webhook_url)}>
        <summary className="cursor-pointer text-sm font-medium">{w.form.events}</summary>
        <p className="mt-2 text-xs text-muted">{w.form.eventsHint}</p>
        <label className="mt-2 flex flex-col gap-1 text-sm font-medium">
          {w.form.eventsUrl}
          <input name="webhook_url" type="url" defaultValue={initial.webhookUrl} placeholder={initial.webhookHint ?? undefined} className={field} />
          {initial.webhookHint && <span className="text-xs font-normal text-muted">{w.form.eventsKeep.replace("{hint}", initial.webhookHint)}</span>}
          {problem("webhook_url")}
        </label>
        {initial.webhookHint && (
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="webhook_clear" className="mt-0.5 size-4" />
            <span>{w.form.eventsClear}</span>
          </label>
        )}
        <fieldset className="mt-3 flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{w.form.topics}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {topics.map((topic) => (
              <label key={topic.value} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="webhook_topics" value={topic.value} defaultChecked={initial.webhookTopics.includes(topic.value)} className="mt-0.5 size-4" />
                <span>
                  {topic.label}
                  <code className="block text-xs text-muted">{topic.value}</code>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </details>
      <details className="rounded-panel border border-line p-3" open={Boolean(problems.logo_url || problems.homepage_url || problems.privacy_url || problems.support_email)}>
        <summary className="cursor-pointer text-sm font-medium">
          {w.form.homepage}, {w.form.privacy.toLowerCase()}, {w.form.support.toLowerCase()}
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          {(
            [
              ["homepage_url", w.form.homepage, initial.homepageUrl, "url"],
              ["privacy_url", w.form.privacy, initial.privacyUrl, "url"],
              ["support_email", w.form.support, initial.supportEmail, "email"],
              ["logo_url", w.form.logo, initial.logoUrl, "url"],
            ] as const
          ).map(([name, label, value, type]) => (
            <label key={name} className="flex flex-col gap-1 text-sm font-medium">
              {label}
              <input name={name} type={type} defaultValue={value} className={field} />
              {problem(name)}
            </label>
          ))}
        </div>
      </details>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? w.form.saving : isNew ? w.form.create : w.form.save}
        </Button>
        {saved && (
          <span role="status" className="text-sm text-muted">
            {w.saved}
          </span>
        )}
      </div>
    </form>
  );
}

/** Renews the app's client or events secret and shows the new one once. */
export function RenewAppSecret({ renew, label }: { renew: () => Promise<Answer>; label: string }) {
  const [pending, start] = useTransition();
  const [shown, setShown] = useState<Shown | null>(null);
  if (shown) return <ShownOnce shown={shown} onDone={() => setShown(null)} />;
  return (
    <Button
      kind="quiet"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const answer = await renew();
          if (answer.ok && answer.shown) setShown(answer.shown);
        })
      }
    >
      {label}
    </Button>
  );
}
