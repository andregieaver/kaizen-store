import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnimatedLogo } from "./animated-logo";
import { AnimationPlayer } from "./animation-view";

/** An animation (D538) as the server draws it, before any script runs. */
const draw = (props: Partial<Parameters<typeof AnimationPlayer>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(AnimationPlayer, {
      video: "https://e.com/page-videos/s/logo.mp4",
      still: "https://e.com/product-media/s/logo.webp",
      alt: "Our logo",
      width: 800,
      height: 450,
      pictureWidth: 1394,
      pictureHeight: 784,
      ...props,
    }),
  );

describe("an animation before its script runs", () => {
  it("keeps its place by its picture, which gives way to a narrower one wherever it stands, the canvas lying over it", () => {
    const html = draw();
    expect(html).toMatch(/<span data-kz-animation="wait" class="relative inline-block max-w-full align-top[^"]*">/);
    // The picture is in the page's flow at its own size and shape: a fixed width would hold a centred column open on a phone.
    expect(html).toMatch(/<img [^>]*width="800" height="450"[^>]*class="block h-auto max-w-full /);
    expect(html).toMatch(/<canvas [^>]*class="absolute inset-0 h-full w-full /);
  });

  it("has a canvas the size of the picture in the video, hidden from screen readers", () => {
    expect(draw()).toMatch(/<canvas aria-hidden="true" width="1394" height="784"/);
  });

  it("holds its last frame as a picture with its description, not shown yet: it opens on its first frame", () => {
    const html = draw();
    expect(html).toMatch(/<img src="https:\/\/e\.com\/product-media\/s\/logo\.webp" alt="Our logo" width="800" height="450" decoding="async" class="[^"]*opacity-0 [^"]*"/);
  });

  it("shows that picture to a visitor without scripts, where nothing can play", () => {
    const html = draw();
    const plain = /<noscript>(.*?)<\/noscript>/.exec(html)?.[1] ?? "";
    expect(plain).toContain('alt="Our logo"');
    expect(plain).not.toContain("opacity-0");
  });

  it("as a logo is as tall as asked and as wide as its shape, and says before the page is drawn whether this tab has played it", () => {
    const html = draw({ fit: "height", width: 222, height: 40, once: "logo:shop" });
    expect(html).toMatch(/<span data-kz-animation="wait" class="relative block shrink-0 " style="height:40px;aspect-ratio:222 \/ 40">/);
    // Right after it, so the script finds it as the element before itself.
    expect(html).toMatch(/<\/span><script>\(function\(\)\{try\{if\(sessionStorage\.getItem\("kz-animation:logo:shop"\)==="1"\)/);
    expect(html).toContain('setAttribute("data-kz-seen","")');
    // Its size from its classes where the header gives one by screen size.
    expect(draw({ fit: "height", width: 222, height: 40, className: "h-8 md:h-10" })).toMatch(/class="relative block shrink-0 h-8 md:h-10" style="aspect-ratio:222 \/ 40"/);
    // A picture in a page plays every time it is seen: no script.
    expect(draw()).not.toContain("<script");
  });

  it("shows the picture at once to a visitor who prefers less motion, and hides the canvas, without any script", () => {
    const html = draw();
    expect(html).toMatch(/<img [^>]*class="[^"]*motion-reduce:opacity-100/);
    expect(html).toMatch(/<canvas [^>]*class="[^"]*motion-reduce:hidden"/);
  });

  it("fetches no video by itself: the player asks for it only when the animation is to play", () => {
    expect(draw()).not.toContain("<video");
    expect(draw()).not.toContain("logo.mp4");
  });
});

describe("a logo that is an animation", () => {
  const animation = {
    video: { url: "https://e.com/page-videos/s/logo.mp4" },
    still: { url: "https://e.com/product-media/s/logo.webp", width: 1600, height: 288 },
    width: 1394,
    height: 250,
  };
  const logo = (props: Partial<Parameters<typeof AnimatedLogo>[0]> = {}) => renderToStaticMarkup(createElement(AnimatedLogo, { animation, alt: "Human Web", name: "human-web", size: "header", ...props }));

  it("is as tall as a header's logo by screen size and as wide as its own shape, and says the site's name", () => {
    const html = logo();
    expect(html).toMatch(/class="relative block shrink-0 h-8 md:h-10" style="aspect-ratio:222 \/ 40"/);
    expect(html).toContain('alt="Human Web"');
    expect(logo({ size: "footer" })).toMatch(/class="relative block shrink-0 h-8" style="aspect-ratio:178 \/ 32"/);
  });

  it("takes the height the logo part was given", () => {
    expect(logo({ height: 72 })).toMatch(/class="relative block shrink-0 " style="height:72px;aspect-ratio:400 \/ 72"/);
  });

  it("plays once a visit under the site's own name", () => {
    expect(logo()).toContain('sessionStorage.getItem("kz-animation:logo:human-web")');
  });
});
