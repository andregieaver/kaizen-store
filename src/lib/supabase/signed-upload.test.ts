import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as unknown[][]);
vi.mock("./client", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        uploadToSignedUrl: (...args: unknown[]) => {
          calls.push([bucket, ...args]);
          return Promise.resolve({ data: { path: "p" }, error: null });
        },
      }),
    },
  }),
}));

import { uploadToSignedUrl } from "./signed-upload";

describe("uploadToSignedUrl", () => {
  it("passes bucket, path, token, file and options through in order and returns the SDK's answer", async () => {
    const file = new Blob(["x"]);
    const answer = await uploadToSignedUrl("media", "a/b.png", "tok", file, { contentType: "image/png" });
    expect(calls).toEqual([["media", "a/b.png", "tok", file, { contentType: "image/png" }]]);
    expect(answer).toEqual({ data: { path: "p" }, error: null });
  });
});
