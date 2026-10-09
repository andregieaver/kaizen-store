import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImageUploadButton } from "./image-upload";
import { MediaPickerProvider } from "./media-picker";

/** Every picture field of an editor can choose from the media library, where the editor gives one (D88). */

const noop = () => {};
const upload = async () => ({ ok: true as const, url: "x" });
const button = (list: Parameters<typeof MediaPickerProvider>[0]["list"], uploads = true) =>
  renderToString(
    createElement(MediaPickerProvider, { list, children: createElement(ImageUploadButton, { upload: uploads ? upload : null, label: "Upload picture", onUploaded: noop }) }),
  );

describe("a picture field", () => {
  it("offers the library beside the upload when the editor has one", () => {
    const out = button(async () => ({ items: [], total: 0 }));
    expect(out).toContain("Upload picture");
    expect(out).toContain("Choose from the library");
  });

  it("is as it was without a library", () => {
    expect(button(null)).not.toContain("library");
  });

  it("still offers the library where uploads are not set up", () => {
    const out = button(async () => ({ items: [], total: 0 }), false);
    expect(out).toContain("Uploads are not set up");
    expect(out).toContain("Choose from the library");
  });
});
