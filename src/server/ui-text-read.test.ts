import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fullCatalog } from "@/lib/ui-catalog-all";

vi.mock("server-only", () => ({}));

const dialect = new PgDialect();
const calls: string[] = [];
let stamp = "1";
const LANGS = ["de", "fr", "fi"];

const uiEntry = fullCatalog().find((e) => !e.key.startsWith("email:"))!;
const emailEntry = fullCatalog().find((e) => e.key.startsWith("email:"))!;

vi.mock("@/db/client", () => ({
  readDb: () => ({
    execute: vi.fn(async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const text = dialect.sqlToQuery(query).sql;
      calls.push(text);
      if (text.includes("p.stamp")) {
        return LANGS.map((lang) => ({ stamp, lang, n: 2, v: `2026-11-13 10:00:0${stamp}` }));
      }
      if (text.includes("where lang = any")) {
        return LANGS.flatMap((lang) => [
          { lang, key: uiEntry.key, text: uiEntry.source },
          { lang, key: emailEntry.key, text: emailEntry.source },
        ]);
      }
      return [{ stamp }];
    }),
  }),
}));

const overlay = vi.hoisted(() => ({ calls: [] as string[], failNext: false }));
vi.mock("@/lib/ui-catalog", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ui-catalog")>();
  return {
    ...real,
    overlayMessages: ((namespace: string, ...rest: unknown[]) => {
      overlay.calls.push(namespace);
      if (overlay.failNext) {
        overlay.failNext = false;
        throw new Error("boom");
      }
      return (real.overlayMessages as (...a: unknown[]) => unknown)(namespace, ...rest);
    }) as typeof real.overlayMessages,
  };
});

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  overlay.calls.length = 0;
  overlay.failNext = false;
  stamp = "1";
  const scope = globalThis as Record<string, unknown>;
  const timer = scope.__kaizenUiTimer as ReturnType<typeof setTimeout> | undefined;
  if (timer) clearTimeout(timer);
  delete scope.__kaizenUiState;
  delete scope.__kaizenUiTimer;
  delete scope.__kaizenUiRegistry;
});

afterEach(() => {
  const scope = globalThis as Record<string, unknown>;
  const timer = scope.__kaizenUiTimer as ReturnType<typeof setTimeout> | undefined;
  if (timer) clearTimeout(timer);
  vi.useRealTimers();
});

describe("the reader of AI-translated interface text", () => {
  it("(a) reads with two statements at start, however many languages, and builds nothing", async () => {
    const read = await import("./ui-text-read");
    await read.startUi();
    expect(calls).toHaveLength(2);
    expect(overlay.calls).toHaveLength(0);
  });

  it("(b) reads with one statement when no language is translated", async () => {
    const read = await import("./ui-text-read");
    LANGS.splice(0, LANGS.length);
    try {
      await read.startUi();
    } finally {
      LANGS.push("de", "fr", "fi");
    }
    expect(calls).toHaveLength(1);
  });

  it("(c) builds a language when t() first reads it, and keeps it", async () => {
    const read = await import("./ui-text-read");
    const { t } = await import("@/lib/i18n");
    const { emailText } = await import("@/lib/email-text");
    await read.startUi();
    t("de");
    expect(overlay.calls.filter((n) => n === "ui")).toHaveLength(1);
    t("de");
    expect(overlay.calls.filter((n) => n === "ui")).toHaveLength(1);
    emailText("de");
    expect(overlay.calls.filter((n) => n === "email")).toHaveLength(1);
  });

  it("(d) a served day costs the start plus one stamp read each ten minutes", async () => {
    const read = await import("./ui-text-read");
    await read.startUi();
    for (let elapsed = 0; elapsed < DAY; elapsed += 9 * 60_000) {
      read.uiTextsFor("de");
      await vi.advanceTimersByTimeAsync(9 * 60_000);
    }
    expect(calls.length).toBeLessThan(150);
    expect(calls.length).toBeGreaterThan(100);
  });

  it("(e) an instance never asked for a translated language only reads at start", async () => {
    const read = await import("./ui-text-read");
    await read.startUi();
    await vi.advanceTimersByTimeAsync(DAY);
    expect(calls).toHaveLength(2);
  });

  it("(f) reads the languages again when the stamp moved, and builds a changed language again", async () => {
    const read = await import("./ui-text-read");
    const { t } = await import("@/lib/i18n");
    await read.startUi();
    t("de");
    expect(overlay.calls.filter((n) => n === "ui")).toHaveLength(1);
    read.uiTextsFor("de");
    stamp = "2";
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(read.POLL_MS + 1000);
    // One stamp read, then the two statements of a refresh.
    expect(calls).toHaveLength(3);
    // The languages' versions moved with the stamp: each is built again on its next read.
    t("de");
    expect(overlay.calls.filter((n) => n === "ui")).toHaveLength(2);
  });

  it("(g) a maker that throws leaves the language in English and does not throw", async () => {
    const read = await import("./ui-text-read");
    const { t } = await import("@/lib/i18n");
    await read.startUi();
    overlay.failNext = true;
    expect(() => t("de")).not.toThrow();
    expect(t("de")).toBe(t("en"));
  });
});
