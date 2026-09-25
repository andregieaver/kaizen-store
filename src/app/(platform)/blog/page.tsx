import type { Metadata } from "next";

import { BlogIndex } from "../term-listing";

export const metadata: Metadata = {
  title: "Blog",
  description: "News and guides from Kaizen: selling online across the EU, and how the platform works.",
  alternates: { canonical: "/blog" },
};

/** Kaizen's blog (D57): its articles, newest first. */
export default function BlogPage() {
  return <BlogIndex />;
}
