"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { GENERATE_MAX } from "@/lib/discounts";

import { useAdminLang, useAdminText } from "./admin-text";
import { Button, Card } from "./ui";

/**
 * A code's single-use codes (D299 E1, `docs/wave-5-marketing.md` 7.1): how many there are and how many were used, a number and an
 * optional prefix to make more, and the CSV to hand them out. The server checks everything again.
 */
export function GeneratedCodes({
  made,
  used,
  canWrite,
  exportHref,
  generate,
}: {
  made: number;
  used: number;
  canWrite: boolean;
  exportHref: string;
  generate: (input: unknown) => Promise<{ ok: true; made: number } | { ok: false; problem: string }>;
}) {
  const w = useAdminText("discounts").generated;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const number = (n: number) => n.toLocaleString(locale);
  const [count, setCount] = useState("100");
  const [prefix, setPrefix] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "problem"; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <Card
      title={w.title}
      description={made === 0 ? w.none : fillWords(w.counts, { made: number(made), used: number(used) })}
      aside={
        made > 0 && canWrite && (
          <form method="post" action={exportHref}>
            <Button type="submit">{w.download}</Button>
          </form>
        )
      }
    >
      {canWrite && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setMessage(null);
              const r = await generate({ count, prefix });
              setMessage(r.ok ? { kind: "ok", text: fillWords(w.made, { n: number(r.made) }) } : { kind: "problem", text: r.problem });
            });
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-ink-2">
            {w.howMany}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={GENERATE_MAX}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="min-h-10 w-32 rounded-md border border-line bg-card px-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-ink-2">
            {w.prefix}
            <input
              value={prefix}
              maxLength={20}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              className="min-h-10 w-40 rounded-md border border-line bg-card px-3 font-mono"
            />
          </label>
          <Button kind="main" type="submit" disabled={busy}>
            {busy ? w.making : w.make}
          </Button>
        </form>
      )}
      {message && (
        <p role={message.kind === "problem" ? "alert" : "status"} className={`mt-3 text-body ${message.kind === "problem" ? "text-danger-text" : "text-positive-text"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}
