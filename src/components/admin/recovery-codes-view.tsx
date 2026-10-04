"use client";

import { useId, useState } from "react";

import { formatCodes } from "@/lib/recovery-codes";

/**
 * A set of recovery codes, shown once (wave 1, 1f, `docs/wave-1-trust.md` 2.6): to copy, download or print, and the person must say they
 * have saved them before they can go on. Each code works once and only until a new set is made; the server keeps only a hash, so this is
 * the one time they can be read. `onContinue` is called when the person, having ticked the box, chooses to go on.
 */
export function RecoveryCodesView({
  codes,
  account,
  madeOn,
  continueLabel = "Continue",
  onContinue,
}: {
  codes: readonly string[];
  account: string;
  /** The day the set was made, `YYYY-MM-DD`, written on the printed copy. */
  madeOn: string;
  continueLabel?: string;
  onContinue: () => void;
}) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState("");
  const text = formatCodes(codes, { account, madeOn });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied. Paste it somewhere safe.");
    } catch {
      setNote("Your browser would not copy. Select the codes and copy them by hand.");
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "kaizen-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setNote("Downloaded. Keep the file apart from the device with your authenticator app.");
  };

  const button = "min-h-10 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-surface";
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <style>{`@media print { body * { visibility: hidden; } [data-print-area], [data-print-area] * { visibility: visible; } [data-print-area] { position: absolute; left: 0; top: 0; } }`}</style>
      <div>
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          Your recovery codes
        </h2>
        <p className="text-sm text-muted">
          If you lose your phone, one of these signs you in once and takes your two-step sign-in away, so you can set it up again. Each code works once.
          <strong className="font-semibold text-foreground"> This is the only time they are shown.</strong>
        </p>
      </div>
      <div data-print-area="" className="rounded-lg border border-border bg-background p-4">
        <p className="mb-3 text-sm">Kaizen Store recovery codes for {account}. Made {madeOn}.</p>
        <ol className="grid grid-cols-1 gap-x-8 gap-y-2 font-mono text-base sm:grid-cols-2">
          {codes.map((code) => (
            <li key={code} className="tabular-nums">
              {code}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={button}>
          Copy codes
        </button>
        <button type="button" onClick={download} className={button}>
          Download as a file
        </button>
        <button type="button" onClick={() => window.print()} className={button}>
          Print
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">
        {note}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="mt-1 size-4" />
        <span>I have saved these codes somewhere safe.</span>
      </label>
      <div>
        <button
          type="button"
          onClick={onContinue}
          disabled={!saved}
          className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
        >
          {continueLabel}
        </button>
      </div>
    </section>
  );
}
