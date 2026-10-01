import { createHash } from "node:crypto";

/**
 * Who sees which version of a tested page (D148): a random but fixed draw from the visitor's id and the test's id, so the
 * same visitor always gets the same answer and two tests never share their draw. Node only: the proxy and the server use
 * it, the browser never does.
 */

/** A number in [0, 1) from the visitor, the test and a purpose (`enroll` or `version`). */
export function unitDraw(visitor: string, experimentId: string, purpose: "enroll" | "version"): number {
  const bytes = createHash("sha256").update(`${purpose}:${experimentId}:${visitor}`).digest();
  // 48 bits are exact in a double.
  return bytes.readUIntBE(0, 6) / 2 ** 48;
}

export type Split = { key: string; share: number }[];

/**
 * The version a visitor is given, or null when they are not enrolled: `trafficShare` of visitors are, and the enrolled
 * are divided by the versions' shares in order.
 */
export function assign(visitor: string, experimentId: string, trafficShare: number, split: Split): string | null {
  if (unitDraw(visitor, experimentId, "enroll") >= trafficShare) return null;
  const draw = unitDraw(visitor, experimentId, "version");
  let upTo = 0;
  for (const { key, share } of split) {
    upTo += share;
    if (draw < upTo) return key;
  }
  // Rounding left a sliver at the top: the last version takes it.
  return split.length > 0 ? split[split.length - 1].key : null;
}
