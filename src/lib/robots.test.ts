import { describe, expect, it } from "vitest";

import { robotsVerdict } from "./robots";

/** Whether research may read a page under a site's robots.txt (D900 M2; RFC 9309); the rules themselves are tested in site-crawl.test.ts. */
describe("robots.txt for research reads (D900 M2)", () => {
  const site = "User-agent: *\nDisallow: /checkout\nAllow: /checkout/help\n\nUser-agent: KaizenaFlowBot\nDisallow: /p/private";

  it("obeys a file read, our own group first", () => {
    expect(robotsVerdict({ status: 200, text: site }, "/p/linen-apron")).toBe("allowed");
    expect(robotsVerdict({ status: 200, text: site }, "/p/private/x")).toBe("refused");
    expect(robotsVerdict({ status: 200, text: "User-agent: *\nDisallow: /" }, "/p/mug")).toBe("refused");
    expect(robotsVerdict({ status: 200, text: "" }, "/p/mug")).toBe("allowed");
    expect(robotsVerdict({ status: 200, text: "User-agent: *\nDisallow: /" }, "")).toBe("refused");
  });

  it("allows on a missing file, and refuses when the site cannot be heard", () => {
    expect(robotsVerdict({ status: 404, text: "" }, "/p/mug")).toBe("allowed");
    expect(robotsVerdict({ status: 410, text: "" }, "/p/mug")).toBe("allowed");
    expect(robotsVerdict({ status: 503, text: "" }, "/p/mug")).toBe("unknown");
    expect(robotsVerdict({ failed: true }, "/p/mug")).toBe("unknown");
  });
});
