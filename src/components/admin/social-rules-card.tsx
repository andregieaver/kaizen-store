"use client";

import { useState, useTransition } from "react";

import { primary } from "@/components/admin/data/ui";
import { Field, Select } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { SocialMessages } from "@/lib/admin-messages/social.en";
import type { SocialRules } from "@/lib/social-rules";

/**
 * *Post on its own within my rules* on the Social posts page (D870 S3.3): Homer has one switch and a sentence saying what it does; Lisa sets
 * the posts a day and the quiet hours under *Customise*. The owner's alone (`saveSocialRules()`); everyone else sees whether it is on.
 */

const hourWords = (h: number) => `${String(h).padStart(2, "0")}:00`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function SocialRulesCard({
  rules,
  mayChange,
  postsMax,
  base,
  words: w,
}: {
  rules: Pick<SocialRules, "on" | "postsPerDay" | "quietFrom" | "quietTo">;
  /** The member is an owner of the store. */
  mayChange: boolean;
  /** The most posts a day the rules may allow (`RULE_POSTS_MAX`, given by the page so this script carries no zod). */
  postsMax: number;
  base: string;
  words: SocialMessages["rules"];
}) {
  const [pending, start] = useTransition();
  const [limits, setLimits] = useState({ postsPerDay: rules.postsPerDay, quietFrom: rules.quietFrom, quietTo: rules.quietTo });
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);

  const save = (on: boolean) =>
    start(async () => {
      setMessage(null);
      const response = await fetch(`${base}/calendar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ do: "rules", on, ...limits }),
      }).catch(() => null);
      const answer = ((await response?.json().catch(() => null)) as { ok: boolean; problem?: string; handedBack?: number } | null) ?? { ok: false };
      if (!answer.ok) return setMessage({ tone: "problem", text: answer.problem ?? w.failed });
      if (!on && answer.handedBack) setMessage({ tone: "ok", text: fillWords(w.handedBack, { n: String(answer.handedBack) }) });
      window.location.reload();
    });

  const lead = rules.on
    ? fillWords(w.onLead, { n: String(rules.postsPerDay), from: hourWords(rules.quietFrom), to: hourWords(rules.quietTo) })
    : w.offLead;

  return (
    <section aria-labelledby="social-rules" className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="social-rules" className="text-title text-ink">
            {w.title}
          </h2>
          <p className="text-body text-ink-2">{lead}</p>
        </div>
        {mayChange ? (
          <button
            type="button"
            role="switch"
            aria-checked={rules.on}
            aria-label={rules.on ? w.switchOff : w.switchOn}
            disabled={pending}
            onClick={() => save(!rules.on)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill transition-colors disabled:opacity-60 ${rules.on ? "bg-brand" : "bg-line"}`}
          >
            <span aria-hidden className={`absolute size-5 rounded-pill bg-card shadow transition-[left] ${rules.on ? "left-6" : "left-1"}`} />
          </button>
        ) : (
          <span className="text-caption text-ink-2">{rules.on ? w.isOn : w.isOff}</span>
        )}
      </div>
      {mayChange ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{w.customise}</summary>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label={w.perDay}>
              {(control) => (
                <Select {...control} value={limits.postsPerDay} onChange={(e) => setLimits({ ...limits, postsPerDay: Number(e.target.value) })}>
                  {Array.from({ length: postsMax }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w.quietFrom} hint={w.quietHint}>
              {(control) => (
                <Select {...control} value={limits.quietFrom} onChange={(e) => setLimits({ ...limits, quietFrom: Number(e.target.value) })}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourWords(h)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w.quietTo}>
              {(control) => (
                <Select {...control} value={limits.quietTo} onChange={(e) => setLimits({ ...limits, quietTo: Number(e.target.value) })}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourWords(h)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <button type="button" className={primary} disabled={pending} onClick={() => save(rules.on)}>
              {w.save}
            </button>
          </div>
        </details>
      ) : (
        <p className="text-caption text-ink-2">{w.ownerOnly}</p>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
