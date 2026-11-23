import { TEST_FLOOR } from "./broadcast-test-sizes";
import { callRates, splitP } from "./experiment-units";

export { TEST_FLOOR, audienceNeeded, testedOf } from "./broadcast-test-sizes";

/**
 * A broadcast's split test (email plan M2.5, D868, `docs/split-tests.md`), the pure part: how big a test is, how many readers it needs,
 * and the call after the wait. The A/B engine's `callRates()` decides, with its interval rule, split check and floor; code counts and
 * calls, a model never declares a winner. Version A is the broadcast's own content; version B changes its subject and preview.
 */

/** What one version's readers did by the call: how many were sent it, pressed a link in it, and left the list or marked it as spam. */
export type VersionFigures = { sent: number; pressed: number; left: number };

export type TestCall = "a" | "b" | "even" | "few" | "broken" | "guard";

export type BroadcastTestResult = {
  /** The version the rest get: the one more people pressed, else A. */
  winner: "a" | "b";
  /** Why: B or A clearly better; no clear difference (`even`); too few readers (`few`); a broken split; or a version losing readers (`guard`). */
  call: TestCall;
  a: VersionFigures;
  b: VersionFigures;
  /** B's press rate minus A's, and the engine's 95 % interval around it; null without both. */
  diff: number | null;
  low: number | null;
  high: number | null;
};

/**
 * The call after the wait. A version whose readers left the list (unsubscribed or marked spam) clearly more often never wins; otherwise
 * the one whose readers pressed clearly more goes to the rest, and with no clear difference, too few readers or a broken split, A does.
 */
export function callBroadcastTest(a: VersionFigures, b: VersionFigures): BroadcastTestResult {
  const splitChance = splitP(a.sent, b.sent, 0.5);
  const left = callRates({ hits: a.left, of: a.sent }, { hits: b.left, of: b.sent }, { rule: "interval", floor: TEST_FLOOR, splitChance, lowerIsBetter: true });
  const pressed = callRates({ hits: a.pressed, of: a.sent }, { hits: b.pressed, of: b.sent }, { rule: "interval", floor: TEST_FLOOR, splitChance });
  const numbers = { a, b, diff: pressed.diff, low: pressed.low, high: pressed.high };
  if (pressed.call === "broken" || pressed.call === "few") return { winner: "a", call: pressed.call, ...numbers };
  if (left.call === "worse") return { winner: "a", call: "guard", ...numbers };
  if (left.call === "better" && pressed.call !== "better") return { winner: "b", call: "guard", ...numbers };
  if (pressed.call === "better") return { winner: "b", call: "b", ...numbers };
  if (pressed.call === "worse") return { winner: "a", call: "a", ...numbers };
  return { winner: "a", call: "even", ...numbers };
}
