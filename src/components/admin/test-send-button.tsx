"use client";

import { useState, useTransition } from "react";

/** Sends a test event now and says how it went (D41). */
export function TestSendButton({ action }: { action: () => Promise<{ ok: boolean; message: string }> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await action()))}
        className="min-h-10 w-fit rounded-md border border-border px-4 text-sm font-medium hover:bg-surface disabled:opacity-50"
      >
        {pending ? "Sending …" : "Send a test"}
      </button>
      <p role="status" className={`text-sm ${result && !result.ok ? "text-red-700 dark:text-red-400" : ""}`}>
        {result?.message}
      </p>
    </div>
  );
}
