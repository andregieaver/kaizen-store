"use client";

import { useMemo, useState } from "react";

import { estimateRuntime } from "@/lib/experiment-results";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { MIN_DAYS } from "@/lib/experiments";

import { useAdminLang, useAdminText } from "./admin-text";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";

/**
 * How long will a test take (D148)? The owner's own guess of how many visitors a day see the page (or part) and accept
 * cookies, and how many of them do the thing today; the answer is worked out here with the function the results use. Kaizen has no
 * page-view numbers to base it on, so it says so rather than inventing them.
 */
export function RuntimeEstimate({ share, versions, minDays = MIN_DAYS }: { share: number; versions: number; minDays?: number }) {
  const words = useAdminText("experiments");
  const w = words.estimate;
  const numberLocale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [perDay, setPerDay] = useState("");
  const [rate, setRate] = useState("");
  const [change, setChange] = useState("20");
  const estimate = useMemo(() => {
    const visitors = Number(perDay);
    const baseline = Number(rate.replace(",", ".")) / 100;
    if (!(visitors > 0) || !(baseline > 0 && baseline < 1)) return null;
    return estimateRuntime({ baseline, relativeChange: Number(change) / 100, versions, eligiblePerDay: visitors, trafficShare: share, minDays, words, numberLocale });
  }, [perDay, rate, change, share, versions, minDays, words, numberLocale]);

  return (
    <div className="flex flex-col gap-3">
      <p className={hint}>
        {w.intro}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>
          {w.perDay}
          <input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} placeholder="200" className={input} />
        </label>
        <label className={label}>
          {w.rate}
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="3" className={input} />
        </label>
        <label className={label}>
          {w.change}
          <select value={change} onChange={(e) => setChange(e.target.value)} className={input}>
            {["10", "20", "30", "50"].map((n) => (
              <option key={n} value={n}>
                {fillWords(w.more, { n })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {estimate && (
        <p role="status" className={`rounded-md border p-3 text-sm ${estimate.tooLong ? "border-warning-text" : "border-line"}`}>
          {estimate.sentence}
        </p>
      )}
    </div>
  );
}
