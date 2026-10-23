import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { capacityEn as w } from "@/lib/admin-messages/capacity.en";
import { GIB } from "@/lib/limits";
import { usageLine, type UsageLine } from "@/lib/usage-view";

import { usageFigure, UsageLines } from "./usage-limits";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");

const line = (over: Partial<Parameters<typeof usageLine>[0]> = {}): UsageLine =>
  usageLine({ metric: "storage_bytes", key: "storage_bytes", used: 3.2 * GIB, measured: true, estimated: false, limit: 10 * GIB, origin: "plan", enforce: "hard", ...over });

describe("usageFigure", () => {
  it("says what is used of what the plan includes", () => {
    expect(usageFigure(line(), w, "en-GB")).toBe("3.2 GB of 10 GB");
    expect(usageFigure(line({ limit: null }), w, "en-GB")).toBe("3.2 GB · No limit");
    expect(usageFigure(line({ metric: "requests", key: "requests_month", used: 12000, limit: null, estimated: true, enforce: "soft" }), w, "en-GB")).toBe("12,000 · No limit (estimated)");
    expect(usageFigure(line({ measured: false }), w, "en-GB")).toBe("Not measured yet");
  });
});

describe("usageLine", () => {
  it("colours a hard limit used up as danger and a soft one as a warning only", () => {
    expect(line({ used: 10 * GIB }).signal).toBe("danger");
    expect(line({ used: 8 * GIB }).signal).toBe("warning");
    expect(line({ metric: "requests", key: "requests_month", used: 200, limit: 100, enforce: "soft" }).signal).toBe("warning");
    expect(line({ measured: false, used: 0 }).state).toBe("ok");
  });
});

describe("UsageLines", () => {
  it("draws a bar per line and nothing more while all is well", () => {
    const out = html(h(UsageLines, { lines: [line()], words: w, locale: "en-GB", plansHref: "/admin/s/billing" }));
    expect(out).toContain("Storage");
    expect(out).toContain("3.2 GB of 10 GB");
    expect(out).not.toContain(w.usage.seePlans);
  });

  it("offers plans when a hard limit is used up, and says the shop stays open for traffic", () => {
    const full = html(h(UsageLines, { lines: [line({ used: 10 * GIB })], words: w, locale: "en-GB", plansHref: "/admin/s/billing" }));
    expect(full).toContain(w.usage.hardReached);
    expect(full).toContain(w.states.reached);
    expect(full).toContain('href="/admin/s/billing"');
    const busy = html(h(UsageLines, { lines: [line({ metric: "requests", key: "requests_month", used: 200, limit: 100, enforce: "soft" })], words: w, locale: "en-GB" }));
    expect(busy).toContain("Your shop stays open");
    expect(busy).not.toContain(w.usage.hardReached);
  });
});
