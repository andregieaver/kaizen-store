import { describe, expect, it } from "vitest";

import { avatarPictureUrl, initials } from "./avatar";
import { gravatarHash, gravatarPath, gravatarSignatureOk, isGravatarHash, signGravatar } from "./gravatar";

describe("initials", () => {
  it("takes the first letters of the first and last names", () => {
    expect(initials("Ada King Lovelace", "ada@example.com")).toBe("AL");
    expect(initials("  åse   øvrebø ", "x@example.com")).toBe("ÅØ");
  });

  it("takes one letter for one name, else the email's first", () => {
    expect(initials("Cher", "c@example.com")).toBe("C");
    expect(initials("", "bob@example.com")).toBe("B");
    expect(initials(null, " _bob@example.com")).toBe("B");
    expect(initials("—", "…")).toBe("?");
  });
});

describe("avatarPictureUrl", () => {
  it("builds the bucket's public address", () => {
    expect(avatarPictureUrl("https://x.supabase.co/", "accounts/a b/c.webp")).toBe(
      "https://x.supabase.co/storage/v1/object/public/avatars/accounts/a%20b/c.webp",
    );
  });
});

describe("gravatar", () => {
  const secret = Buffer.alloc(32, 7);

  it("hashes the trimmed, lower-case address with SHA-256", () => {
    // Gravatar's own example.
    expect(gravatarHash(" MyEmailAddress@example.com ")).toBe(
      "84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee",
    );
    expect(isGravatarHash(gravatarHash("a@b.c"))).toBe(true);
    expect(isGravatarHash("abc")).toBe(false);
  });

  it("signs addresses so only Kaizen's own work", () => {
    const hash = gravatarHash("a@example.com");
    const path = gravatarPath("A@example.com", secret);
    const k = new URL(path, "https://kaizen.test").searchParams.get("k")!;
    expect(path.startsWith(`/api/gravatar/${hash}?k=`)).toBe(true);
    expect(gravatarSignatureOk(hash, k, secret)).toBe(true);
    expect(gravatarSignatureOk(gravatarHash("b@example.com"), k, secret)).toBe(false);
    expect(gravatarSignatureOk(hash, k, Buffer.alloc(32, 8))).toBe(false);
    expect(gravatarSignatureOk(hash, "short", secret)).toBe(false);
    expect(gravatarSignatureOk("../etc", signGravatar("../etc", secret), secret)).toBe(false);
  });
});
