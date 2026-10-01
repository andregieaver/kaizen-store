"use client";

import { useMemo, useState } from "react";

import { estimateRuntime } from "@/lib/experiment-results";
import { MIN_DAYS } from "@/lib/experiments";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";

/**
 * How long will a test take (D148)? The owner's own guess of how many visitors a day see the page (or part) and accept
 * cookies, and how many of them do the thing today; the answer is worked out here with the function the results use. Kaizen has no
 * page-view numbers to base it on, so it says so rather than inventing them.
 */
export function RuntimeEstimate({ share, versions, minDays = MIN_DAYS }: { share: number; versions: number; minDays?: number }) {
  const [perDay, setPerDay] = useState("");
  const [rate, setRate] = useState("");
  const [change, setChange] = useState("20");
  const estimate = useMemo(() => {
    const visitors = Number(perDay);
    const baseline = Number(rate.replace(",", ".")) / 100;
    if (!(visitors > 0) || !(baseline > 0 && baseline < 1)) return null;
    return estimateRuntime({ baseline, relativeChange: Number(change) / 100, versions, eligiblePerDay: visitors, trafficShare: share, minDays });
  }, [perDay, rate, change, share, versions, minDays]);

  return (
    <div className="flex flex-col gap-3">
      <p className={hint}>
        A test needs enough visitors before it can say anything. Tell us roughly how many visitors a day see this and accept cookies, and how many of them do
        the thing you want today.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>
          Visitors a day
          <input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} placeholder="200" className={input} />
        </label>
        <label className={label}>
          Who do it today (%)
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="3" className={input} />
        </label>
        <label className={label}>
          Change worth finding
          <select value={change} onChange={(e) => setChange(e.target.value)} className={input}>
            <option value="10">10 % more</option>
            <option value="20">20 % more</option>
            <option value="30">30 % more</option>
            <option value="50">50 % more</option>
          </select>
        </label>
      </div>
      {estimate && (
        <p role="status" className={`rounded-md border p-3 text-sm ${estimate.tooLong ? "border-amber-500" : "border-border"}`}>
          {estimate.sentence}
        </p>
      )}
    </div>
  );
}
