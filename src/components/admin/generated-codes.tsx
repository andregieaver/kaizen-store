"use client";

import { useState, useTransition } from "react";

import { GENERATE_MAX } from "@/lib/discounts";

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
  const [count, setCount] = useState("100");
  const [prefix, setPrefix] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "problem"; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <Card
      title="Single-use codes"
      description={
        made === 0
          ? "None made yet. Each code you make works for one order."
          : `${made.toLocaleString("en-GB")} made, ${used.toLocaleString("en-GB")} used. Each works for one order.`
      }
      aside={
        made > 0 && canWrite && (
          <form method="post" action={exportHref}>
            <Button type="submit">Download the codes</Button>
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
              setMessage(r.ok ? { kind: "ok", text: `Made ${r.made.toLocaleString("en-GB")} codes.` } : { kind: "problem", text: r.problem });
            });
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-ink-2">
            How many
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
            Prefix (optional)
            <input
              value={prefix}
              maxLength={20}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              className="min-h-10 w-40 rounded-md border border-line bg-card px-3 font-mono"
            />
          </label>
          <Button kind="main" type="submit" disabled={busy}>
            {busy ? "Making…" : "Make codes"}
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
