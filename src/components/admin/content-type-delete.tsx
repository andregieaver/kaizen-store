"use client";

import { useState, useTransition } from "react";

import type { ContentCall } from "@/lib/content-types";

/** Deletes a content type with its entries after one question (D326); the server action goes back to Content. */
export function DeleteContentTypeButton({
  label,
  question,
  remove,
}: {
  label: string;
  question: string;
  remove: ContentCall;
}) {
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();
  return (
    <div className="border-t border-line pt-4">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(question)) return;
          start(async () => {
            const result = await remove();
            if (result && !result.ok) setProblems(result.problems);
          });
        }}
        className="min-h-10 rounded-pill px-4 text-sm text-danger-text hover:bg-danger-soft disabled:opacity-50"
      >
        {label}
      </button>
      {problems.length > 0 && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {problems.join(" ")}
        </p>
      )}
    </div>
  );
}
