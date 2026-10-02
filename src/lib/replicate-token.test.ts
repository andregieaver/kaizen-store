import { describe, expect, it } from "vitest";

import { FRAME_MINUTES, frameTokenValid, signFrame } from "./replicate-token";

const secret = Buffer.alloc(32, 9);
const id = "6b2f1c7e-1c1e-4d6c-9a39-0e1f7a4b2d10";

describe("the token for a copy's preview page", () => {
  it("opens the job it was made for, until it runs out", () => {
    const now = 1_000_000;
    const token = signFrame(secret, id, now);
    expect(frameTokenValid(secret, id, token, now + 1000)).toBe(true);
    expect(frameTokenValid(secret, id, token, now + FRAME_MINUTES * 60_000 + 1)).toBe(false);
  });

  it("opens nothing else, and nothing made with another key or by hand", () => {
    const token = signFrame(secret, id);
    expect(frameTokenValid(secret, "00000000-0000-4000-8000-000000000000", token)).toBe(false);
    expect(frameTokenValid(Buffer.alloc(32, 1), id, token)).toBe(false);
    for (const bad of [undefined, "", "abc", "123.", `${Date.now() + 100000}.forged`, `${Date.now() + 100000}`]) expect(frameTokenValid(secret, id, bad)).toBe(false);
    // The expiry cannot be moved: it is part of what is signed.
    const [expires, signature] = token.split(".");
    expect(frameTokenValid(secret, id, `${Number(expires) + 60_000}.${signature}`)).toBe(false);
  });
});
