import { describe, expect, it } from "vitest";

import { pageEmails, pageText } from "./web-page-text";

describe("a page's addresses, for code alone (D899)", () => {
  it("finds them in the footer and in mailto links, which the text leaves out, once each and folded", () => {
    const html = `<html><body><main><p>${"Vi lager kaffe. ".repeat(20)}</p></main><footer><a href="mailto:Post%40Kafe.no?subject=Hei">Send oss en e-post</a> · post@kafe.no · <a href="mailto:ola&#64;kafe.no">Ola</a></footer></body></html>`;
    expect(pageEmails(html)).toEqual(["post@kafe.no", "ola@kafe.no"]);
    expect(pageText(html, "text/html").text).not.toContain("@");
  });
});
