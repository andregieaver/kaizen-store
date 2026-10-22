import type { Metadata } from "next";

import { BlogRoute, blogMetadata } from "@/components/platform-routes/blog";

export function generateMetadata(): Promise<Metadata> {
  return blogMetadata("en");
}

/** Kaizen's blog in English (D57, D143, D312). */
export default function BlogPage({ searchParams }: PageProps<"/blog">) {
  return <BlogRoute lang="en" searchParams={searchParams} />;
}
