import { describe, expect, it } from "vitest";

import {
  KILL_SWITCH_ACTION,
  TWO_STEP_LIMIT,
  TWO_STEP_PATHS,
  assuranceOf,
  attemptState,
  enrolReasonText,
  heldPath,
  lockedText,
  mayUseAdmin,
  normaliseTotp,
  twoStepKillSwitch,
  type Assurance,
  type AssuranceInput,
} from "./two-step";

const base: AssuranceInput = { level: "aal1", enrolled: false, platformAdmin: false, storeRequires: false, reenrolPending: false, killSwitch: false };
const of = (over: Partial<AssuranceInput>) => assuranceOf({ ...base, ...over });

describe("whether a session may use the admin", () => {
  it("lets an ordinary member with no factor in, where nothing requires one", () => {
    expect(of({})).toEqual({ state: "ok" });
  });

  it("asks anyone with a factor for it, whatever the store says", () => {
    expect(of({ enrolled: true })).toEqual({ state: "challenge" });
    expect(of({ enrolled: true, storeRequires: true })).toEqual({ state: "challenge" });
    expect(of({ enrolled: true, platformAdmin: true })).toEqual({ state: "challenge" });
  });

  it("holds a platform admin with no factor at enrolment", () => {
    expect(of({ platformAdmin: true })).toEqual({ state: "enrol", reason: "platform" });
  });

  it("holds a member of a store that requires it, and only for that store", () => {
    expect(of({ storeRequires: true })).toEqual({ state: "enrol", reason: "store" });
    expect(of({ storeRequires: false })).toEqual({ state: "ok" });
  });

  it("forces enrolment after a reset even where nothing requires it, and says reset first", () => {
    expect(of({ reenrolPending: true })).toEqual({ state: "enrol", reason: "reset" });
    expect(of({ reenrolPending: true, platformAdmin: true, storeRequires: true })).toEqual({ state: "enrol", reason: "reset" });
  });

  it("lets a session at aal2 through, whatever is required", () => {
    expect(of({ level: "aal2", enrolled: true, platformAdmin: true, storeRequires: true })).toEqual({ state: "ok" });
    // aal2 proves a factor: what the server found about enrolment does not matter, even when it could not be read.
    expect(of({ level: "aal2", enrolled: null, platformAdmin: true })).toEqual({ state: "ok" });
    expect(of({ level: "aal2", enrolled: false, reenrolPending: true })).toEqual({ state: "ok" });
  });

  it("holds an aal1 session whose enrolment could not be read, and never lets it through", () => {
    for (const platformAdmin of [false, true]) {
      for (const storeRequires of [false, true]) {
        expect(of({ enrolled: null, platformAdmin, storeRequires })).toEqual({ state: "unknown" });
      }
    }
  });

  it("lifts everything with the kill switch", () => {
    expect(of({ killSwitch: true, platformAdmin: true, storeRequires: true, enrolled: true })).toEqual({ state: "off" });
    expect(of({ killSwitch: true, enrolled: null })).toEqual({ state: "off" });
    expect(mayUseAdmin({ state: "off" })).toBe(true);
  });

  it("agrees with an independent statement of the rules over every combination", () => {
    // The rules as a person would write them, not as the function is built.
    const expected = (i: AssuranceInput): Assurance => {
      if (i.killSwitch) return { state: "off" };
      if (i.level === "aal2") return { state: "ok" };
      const required = i.platformAdmin || i.storeRequires || i.reenrolPending;
      if (i.enrolled === null) return { state: "unknown" };
      if (i.enrolled === true) return { state: "challenge" };
      if (!required) return { state: "ok" };
      return { state: "enrol", reason: i.reenrolPending ? "reset" : i.platformAdmin ? "platform" : "store" };
    };
    let count = 0;
    for (const level of ["aal1", "aal2"] as const)
      for (const enrolled of [true, false, null])
        for (const platformAdmin of [true, false])
          for (const storeRequires of [true, false])
            for (const reenrolPending of [true, false])
              for (const killSwitch of [true, false]) {
                const input: AssuranceInput = { level, enrolled, platformAdmin, storeRequires, reenrolPending, killSwitch };
                expect([input, assuranceOf(input)]).toEqual([input, expected(input)]);
                count += 1;
              }
    expect(count).toBe(96);
  });

  it("lets only ok and off into the admin", () => {
    expect(mayUseAdmin({ state: "ok" })).toBe(true);
    expect(mayUseAdmin({ state: "off" })).toBe(true);
    expect(mayUseAdmin({ state: "challenge" })).toBe(false);
    expect(mayUseAdmin({ state: "enrol", reason: "store" })).toBe(false);
    expect(mayUseAdmin({ state: "unknown" })).toBe(false);
  });
});

describe("where a held person is sent", () => {
  it("sends a challenge and an enrolment to pages outside the gated area, with where to go after", () => {
    expect(heldPath({ state: "challenge" })).toBe("/admin/sign-in/two-step");
    expect(heldPath({ state: "enrol", reason: "platform" }, "/admin/platform")).toBe("/admin/sign-in/two-step/set-up?next=%2Fadmin%2Fplatform");
    expect(heldPath({ state: "ok" })).toBeNull();
    expect(heldPath({ state: "off" })).toBeNull();
    expect(heldPath({ state: "unknown" })).toBeNull();
    for (const path of Object.values(TWO_STEP_PATHS)) expect(path.startsWith("/admin/sign-in/")).toBe(true);
  });

  it("says why", () => {
    expect(enrolReasonText("platform")).toBe("Platform admins must use two-step sign-in.");
    expect(enrolReasonText("store", "Demo Shop")).toBe("Demo Shop requires two-step sign-in.");
    expect(enrolReasonText("store", "  ")).toBe("This store requires two-step sign-in.");
    expect(enrolReasonText("reset")).toMatch(/reset/);
  });

  it("reads the kill switch strictly", () => {
    expect(twoStepKillSwitch("off")).toBe(true);
    expect(twoStepKillSwitch(" OFF ")).toBe(true);
    for (const value of ["", "on", "0", "false", "no", undefined, null, "offline"]) expect(twoStepKillSwitch(value)).toBe(false);
    expect(KILL_SWITCH_ACTION).toBe("account.two_step_switch_off");
  });
});

describe("the limit on wrong codes", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);

  it("is five in fifteen minutes", () => {
    expect(TWO_STEP_LIMIT).toEqual({ attempts: 5, windowMinutes: 15 });
  });

  it("counts what is left", () => {
    expect(attemptState([], now)).toEqual({ locked: false, remaining: 5 });
    expect(attemptState([ago(1), ago(2)], now)).toEqual({ locked: false, remaining: 3 });
    expect(attemptState([ago(1), ago(2), ago(3), ago(4)], now)).toEqual({ locked: false, remaining: 1 });
  });

  it("pauses at the fifth failure until fifteen minutes after it, so the sixth attempt is refused", () => {
    const failures = [ago(5), ago(4), ago(3), ago(2), ago(1)];
    const state = attemptState(failures, now);
    expect(state.locked).toBe(true);
    if (state.locked) {
      expect(state.until.toISOString()).toBe(new Date(ago(1).getTime() + 15 * 60 * 1000).toISOString());
      expect(state.minutes).toBe(14);
    }
  });

  it("does not count failures older than the window", () => {
    expect(attemptState([ago(16), ago(20), ago(60), ago(1), ago(2)], now)).toEqual({ locked: false, remaining: 3 });
    // The boundary: exactly fifteen minutes ago is out, a second inside it is in.
    expect(attemptState([ago(15)], now)).toEqual({ locked: false, remaining: 5 });
    expect(attemptState([new Date(ago(15).getTime() + 1000)], now)).toEqual({ locked: false, remaining: 4 });
  });

  it("lets an account in again once the pause has run out", () => {
    const failures = [ago(30), ago(29), ago(28), ago(27), ago(26)];
    expect(attemptState(failures, now)).toEqual({ locked: false, remaining: 5 });
    // Five in the window that ended a moment ago: still paused for the minutes left.
    const state = attemptState([ago(14), ago(13), ago(12), ago(11), ago(10)], now);
    expect(state.locked && state.minutes).toBe(5);
  });

  it("ignores a failure from the future, and the order of the list", () => {
    expect(attemptState([new Date(now.getTime() + 60_000)], now)).toEqual({ locked: false, remaining: 5 });
    const shuffled = [ago(1), ago(5), ago(3), ago(2), ago(4)];
    expect(attemptState(shuffled, now).locked).toBe(true);
  });

  it("words the pause", () => {
    expect(lockedText(15)).toBe("Too many attempts. Wait 15 minutes.");
    expect(lockedText(1)).toBe("Too many attempts. Wait a minute.");
  });
});

describe("the code from an authenticator app", () => {
  it("is six digits, with spaces or a hyphen allowed", () => {
    expect(normaliseTotp("123456")).toBe("123456");
    expect(normaliseTotp(" 123 456 ")).toBe("123456");
    expect(normaliseTotp("123-456")).toBe("123456");
    for (const bad of ["12345", "1234567", "12345a", "", "K7QM2-9WXDB"]) expect(normaliseTotp(bad)).toBeNull();
  });
});
