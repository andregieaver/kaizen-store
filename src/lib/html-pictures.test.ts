import { describe, expect, it } from "vitest";

import { PAGE_PICTURES_MAX, splitPictures } from "./html-pictures";

describe("a page's HTML split at its pictures (D446 step 3)", () => {
  it("keeps the words before, between and after each picture in their order, and each picture's largest size and alt text", () => {
    const html = `<h2>Our story</h2><p>We knit.</p><figure class="wp-block-image"><img src="https://myshop.com/a-300.jpg" srcset="https://myshop.com/a-300.jpg 300w, https://myshop.com/a-1200.jpg 1200w" alt="Kari &amp; Ola"></figure><p>By hand.</p><img src="/wp-content/uploads/b.png" alt=''>`;
    expect(splitPictures(html, "https://myshop.com")).toEqual({
      leftOut: 0,
      parts: [
        { kind: "html", html: '<h2>Our story</h2><p>We knit.</p><figure class="wp-block-image">' },
        { kind: "picture", src: "https://myshop.com/a-1200.jpg", alt: "Kari & Ola" },
        { kind: "html", html: "</figure><p>By hand.</p>" },
        { kind: "picture", src: "https://myshop.com/wp-content/uploads/b.png", alt: "" },
      ],
    });
  });

  it("leaves a picture that is not a web address, and every one past the most a page brings", () => {
    expect(splitPictures(`<p>a</p><img src="data:image/png;base64,AAA"><img>`)).toEqual({ leftOut: 2, parts: [{ kind: "html", html: "<p>a</p>" }] });
    const many = Array.from({ length: PAGE_PICTURES_MAX + 2 }, (_, n) => `<img src="https://x.example/${n}.jpg">`).join("");
    const split = splitPictures(many);
    expect([split.parts.length, split.leftOut]).toEqual([PAGE_PICTURES_MAX, 2]);
  });

  it("gives a page without pictures back as it is", () => {
    expect(splitPictures("<p>Just words.</p>")).toEqual({ leftOut: 0, parts: [{ kind: "html", html: "<p>Just words.</p>" }] });
  });
});
