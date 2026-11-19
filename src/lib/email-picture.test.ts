import { describe, expect, it } from "vitest";

import { emailPictureSignatureOk, emailPictureUrl, emailPictureWidth, signEmailPicture } from "./email-picture";

const secret = Buffer.alloc(32, 7);
const AVIF = "https://media.example.com/storage/v1/object/public/product-media/s/ingrid.avif";

describe("pictures in emails (D332)", () => {
  it("sends WebP and AVIF through the converter, signed, at an allowed width", () => {
    const url = new URL(emailPictureUrl(AVIF, 112, "https://kaizenaflow.com/", secret)!);
    expect(url.origin + url.pathname).toBe("https://kaizenaflow.com/api/email-picture");
    expect(url.searchParams.get("u")).toBe(AVIF);
    expect(url.searchParams.get("w")).toBe("112");
    expect(emailPictureSignatureOk(AVIF, 112, url.searchParams.get("k")!, secret)).toBe(true);
    // Another picture, another width or another key is refused.
    expect(emailPictureSignatureOk(`${AVIF}x`, 112, url.searchParams.get("k")!, secret)).toBe(false);
    expect(emailPictureSignatureOk(AVIF, 1024, url.searchParams.get("k")!, secret)).toBe(false);
    expect(emailPictureSignatureOk(AVIF, 112, signEmailPicture(AVIF, 112, Buffer.alloc(32, 8)), secret)).toBe(false);
    expect(emailPictureSignatureOk(AVIF, 112, "short", secret)).toBe(false);
  });

  it("keeps PNG, JPEG and GIF as they are, and refuses anything but https", () => {
    expect(emailPictureUrl("https://cdn.example.com/logo.PNG", 256, "https://kaizenaflow.com", secret)).toBe("https://cdn.example.com/logo.PNG");
    expect(emailPictureUrl("https://cdn.example.com/a.jpg?v=2", 256, "https://kaizenaflow.com", secret)).toBe("https://cdn.example.com/a.jpg?v=2");
    expect(emailPictureUrl("http://cdn.example.com/a.webp", 256, "https://kaizenaflow.com", secret)).toBeNull();
    expect(emailPictureUrl(null, 256, "https://kaizenaflow.com", secret)).toBeNull();
    // Without a key, the picture as it is rather than none.
    expect(emailPictureUrl(AVIF, 112, "https://kaizenaflow.com", null)).toBe(AVIF);
  });

  it("cuts a person's picture square, signed as such, whatever its kind", () => {
    const url = new URL(emailPictureUrl("https://cdn.example.com/me.jpg", 112, "https://kaizenaflow.com", secret, true)!);
    expect(url.searchParams.get("s")).toBe("1");
    expect(emailPictureSignatureOk("https://cdn.example.com/me.jpg", 112, url.searchParams.get("k")!, secret, true)).toBe(true);
    // A square's signature does not serve the whole picture, nor the reverse.
    expect(emailPictureSignatureOk("https://cdn.example.com/me.jpg", 112, url.searchParams.get("k")!, secret, false)).toBe(false);
  });

  it("rounds a width up to an allowed one", () => {
    expect(emailPictureWidth(100)).toBe(112);
    expect(emailPictureWidth(366)).toBe(400);
    expect(emailPictureWidth(5000)).toBe(1024);
  });
});
