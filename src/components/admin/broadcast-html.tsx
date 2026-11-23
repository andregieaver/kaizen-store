"use client";

import { useState, useTransition } from "react";

import { HTML_BLOCK_MAX } from "@/lib/broadcasts";

import { useAdminText } from "./admin-text";
import { Button } from "./ui/button";

type Problem = { ok: false; problem: string };
/** The server's cleaning of the HTML as it would be sent (M4.1), the store bound by the caller. */
export type CleanHtml = (storeSlug: string, html: string) => Promise<Problem | { ok: true; html: string }>;

/**
 * An own HTML block in a broadcast's editor (email plan M4.1, for Lisa): the HTML as written, what is removed said once, and *Show how it
 * looks*, which draws the server's cleaned HTML in a frame with no scripts, no forms and an origin of its own, so nothing in it reaches
 * the admin.
 */
export function HtmlFields({ html, storeSlug, field, clean, onChange }: { html: string; storeSlug: string; field: string; clean: CleanHtml; onChange: (html: string) => void }) {
  const we = useAdminText("marketing").email;
  const [shown, setShown] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const show = () =>
    start(async () => {
      const result = await clean(storeSlug, html);
      if (!result.ok) return setProblem(result.problem);
      setProblem(null);
      setShown(result.html);
    });
  return (
    <div className="flex flex-col gap-2" data-html-block>
      <p className="text-caption text-muted">{we.htmlHint}</p>
      <textarea
        aria-label={we.blocks.html}
        value={html}
        maxLength={HTML_BLOCK_MAX}
        rows={8}
        spellCheck={false}
        onChange={(e) => {
          setShown(null);
          onChange(e.target.value);
        }}
        className={`${field} py-2 font-mono text-caption`}
      />
      <div className="flex">
        <Button size="dense" disabled={busy || !html.trim()} onClick={show}>
          {we.htmlShow}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-caption text-danger-text">
          {problem}
        </p>
      )}
      {shown !== null && (
        <iframe
          title={we.htmlShown}
          sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;font-family:sans-serif;font-size:16px;line-height:1.5;color:#171717">${shown}</body>`}
          className="h-72 w-full rounded-md border border-line bg-white"
        />
      )}
    </div>
  );
}
