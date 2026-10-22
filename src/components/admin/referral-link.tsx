"use client";

import { useState } from "react";

import { useAdminText } from "@/components/admin/admin-text";

/** A referral link to read and copy (D131): the address in a field that selects itself, and a button that copies it. */
export function ReferralLink({ link, code }: { link: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const w = useAdminText("loyalty").referrals;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="referral-link" className="text-sm font-medium">
        {w.yourLink}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="referral-link"
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-card px-3 font-mono text-sm"
        />
        <button type="button" onClick={copy} className="min-h-11 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          {copied ? w.link.copied : w.link.copy}
        </button>
      </div>
      <p className="text-sm text-muted">
        {w.link.code}
        <span className="font-mono">{code}</span>. <span role="status">{copied ? w.link.onClipboard : ""}</span>
      </p>
    </div>
  );
}
