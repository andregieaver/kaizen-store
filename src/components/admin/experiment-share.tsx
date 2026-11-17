"use client";

import { Link2 } from "lucide-react";
import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { Button, Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { experimentProblems } from "@/lib/experiment-words";

type Outcome = { ok: true; url: string } | { ok: false; problems: string[] };

/**
 * A running test's preview links to share (D148 phase 20): one press per version makes the link, copies it and shows it to copy by hand. The link
 * shows that version on the live site to whoever opens it, for a day, never counted, and stops working when the test stops.
 */
export function ExperimentShare({ versions, make }: { versions: { key: string; name: string }[]; make: (key: string) => Promise<Outcome> }) {
  const w = useAdminText("experiments");
  const s = w.share;
  const [pending, start] = useTransition();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const share = (key: string) =>
    start(async () => {
      setProblems([]);
      const result = await make(key);
      if (!result.ok) {
        setProblems(experimentProblems(result.problems, w));
        return;
      }
      setLinks((had) => ({ ...had, [key]: result.url }));
      try {
        await navigator.clipboard.writeText(result.url);
        setCopied(key);
      } catch {
        // No clipboard (an insecure page, a refused permission): the link is shown to copy by hand.
        setCopied(null);
      }
    });
  return (
    <div data-share>
    <Card title={s.title} description={s.intro} className="flex flex-col gap-3" compact>
      <div className="flex flex-wrap gap-2">
        {versions.map((v) => (
          <Button key={v.key} kind="secondary" disabled={pending} onClick={() => share(v.key)} data-share-version={v.key}>
            <Link2 aria-hidden strokeWidth={1.75} />
            {fillWords(s.copy, { name: v.name })}
          </Button>
        ))}
      </div>
      {versions.map((v) =>
        links[v.key] ? (
          <label key={v.key} className="flex flex-col gap-1 text-sm font-medium">
            {fillWords(s.link, { name: v.name })}
            <input readOnly value={links[v.key]} onFocus={(e) => e.currentTarget.select()} className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal" data-share-link={v.key} />
          </label>
        ) : null,
      )}
      <p role="status" className="text-caption text-positive-text">
        {copied ? fillWords(s.copied, { name: versions.find((v) => v.key === copied)?.name ?? "" }) : ""}
      </p>
      {problems.length > 0 && (
        <p role="alert" className="text-sm text-danger-text">
          {problems.join(" ")}
        </p>
      )}
    </Card>
    </div>
  );
}
