import { describe, expect, it } from "vitest";

import { cookiesReadable, serviceWorkerOf } from "./browser-access";

/** An object whose property throws as a sandboxed frame's does (D127's template preview). */
const refusing = (property: string) =>
  Object.defineProperty({}, property, {
    enumerable: true,
    get() {
      throw new DOMException("The document is sandboxed and lacks the 'allow-same-origin' flag.", "SecurityError");
    },
  });

describe("what a document may use of the browser", () => {
  it("gives the service worker container where there is one", () => {
    const container = { register: () => Promise.resolve() } as unknown as ServiceWorkerContainer;
    expect(serviceWorkerOf({ serviceWorker: container } as unknown as Navigator)).toBe(container);
  });

  it("gives none where the browser has none, or refuses it to a sandboxed frame, never throwing", () => {
    expect(serviceWorkerOf({} as Navigator)).toBeNull();
    expect(() => serviceWorkerOf(refusing("serviceWorker") as Navigator)).not.toThrow();
    expect(serviceWorkerOf(refusing("serviceWorker") as Navigator)).toBeNull();
  });

  it("says whether cookies can be read, never throwing", () => {
    expect(cookiesReadable({ cookie: "a=1" })).toBe(true);
    expect(cookiesReadable({ cookie: "" })).toBe(true);
    expect(cookiesReadable(refusing("cookie") as Pick<Document, "cookie">)).toBe(false);
  });
});
