"use client";

import { useState } from "react";

import { useAdminText } from "@/components/admin/admin-text";

/** One feed's address to copy (D302): the address in a field that selects itself, and a button that copies it. */
export function FeedAddress({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);
  const w = useAdminText("marketing").feeds;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-ink-2">{label}</span>
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          aria-label={label}
          value={address}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-10 min-w-0 flex-1 rounded-md border border-line bg-card px-3 font-mono text-xs"
        />
        <button type="button" onClick={copy} className="min-h-10 rounded-pill border border-line px-4 text-sm">
          {copied ? w.copied : w.copy}
        </button>
      </div>
    </div>
  );
}
