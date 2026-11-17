import { describe, expect, it } from "vitest";

import { isApiPower, isApiScope, TOKEN_KINDS } from "./admin-api";

describe("the ready kinds of token (D700)", () => {
  it("hold real scopes, never a power", () => {
    for (const scopes of Object.values(TOKEN_KINDS)) {
      for (const scope of scopes) {
        expect(isApiScope(scope)).toBe(true);
        expect(isApiPower(scope)).toBe(false);
      }
    }
  });

  it("let Read everything change nothing", () => {
    expect(TOKEN_KINDS.read.every((scope) => scope.endsWith(":read"))).toBe(true);
  });
});
