"use client";

import { useRouter } from "next/navigation";

/**
 * Round 29 (D702): a row of filter chips as one choice on a phone. Each option is an address; choosing one goes there, as pressing
 * its chip would. The chips stay from the small breakpoint up.
 */
export function SelectNav({ label, options, className = "" }: { label: string; options: { label: string; href: string; current: boolean }[]; className?: string }) {
  const router = useRouter();
  const current = options.find((o) => o.current)?.href ?? options[0]?.href ?? "";
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-caption text-ink-2 ${className}`}>
      {label}
      <select
        value={current}
        onChange={(event) => router.push(event.target.value)}
        className="min-h-11 w-full rounded-pill border border-line bg-card px-4 text-body text-ink"
      >
        {options.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
