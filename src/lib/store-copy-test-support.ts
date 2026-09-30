import type { CopyChoices, StoreCopyProgress } from "./store-copy";

/** Choices and progress for the wizard's tests (D129). */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function choicesOf(over: Partial<CopyChoices> = {}): CopyChoices {
  return {
    source: { slug: "kaffe", name: "Kaffe & Co" },
    pages: [
      { id: uuid(1), title: "About us", slug: "about", state: "published" },
      { id: uuid(2), title: "Delivery", slug: "delivery", state: "draft" },
      { id: uuid(3), title: "Café stories", slug: "stories", state: "changed" },
    ],
    products: Array.from({ length: 40 }, (_, i) => ({
      id: uuid(100 + i),
      title: `Product ${i + 1}`,
      handle: `product-${i + 1}`,
      status: i % 5 === 0 ? "draft" : "active",
      image: i === 0 ? "https://example.test/one.webp" : null,
    })),
    posts: [{ id: uuid(200), title: "Hello", slug: "hello", state: "published" }],
    customers: 210,
    orders: 128,
    settings: [
      { label: "Menus", count: 3 },
      { label: "Markets", count: 2 },
    ],
    ...over,
  };
}

export const idOf = uuid;

export function progressOf(over: Partial<StoreCopyProgress> = {}): StoreCopyProgress {
  return {
    id: uuid(900),
    status: "running",
    phase: "media",
    sourceName: "Kaffe & Co",
    sourceSlug: "kaffe-co",
    newName: "Copy of Kaffe & Co",
    newSlug: "copy-of-kaffe-co",
    counts: {
      pages: { done: 3, total: 3 },
      products: { done: 40, total: 40 },
      posts: { done: 1, total: 1 },
      customers: { done: 0, total: 210 },
      orders: { done: 0, total: 0 },
      media: { done: 12, total: 90 },
    },
    mediaLeftOut: 0,
    problem: null,
    startedAt: "2026-09-30T10:00:00Z",
    finishedAt: null,
    ...over,
  };
}
