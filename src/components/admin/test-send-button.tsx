"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "./admin-text";

/** Sends a test event now and says how it went (D41). */
export function TestSendButton({ action }: { action: () => Promise<{ ok: boolean; message: string }> }) {
  const w = useAdminText("notifications").integrations.provider;
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await action()))}
        className="min-h-10 w-fit rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken disabled:opacity-50"
      >
        {pending ? w.sending : w.sendTest}
      </button>
      <p role="status" className={`text-sm ${result && !result.ok ? "text-danger-text " : ""}`}>
        {result?.message}
      </p>
    </div>
  );
}
