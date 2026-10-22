import type { Metadata } from "next";

import { BlogRoute, blogMetadata } from "@/components/platform-routes/blog";

export function generateMetadata(): Promise<Metadata> {
  return blogMetadata("nb");
}

export default function NorwegianBlog({ searchParams }: PageProps<"/nb/blog">) {
  return <BlogRoute lang="nb" searchParams={searchParams} />;
}
