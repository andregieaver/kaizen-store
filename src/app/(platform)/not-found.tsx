import Link from "next/link";

import { PageArticle, pageRoomClass } from "@/components/page-article";
import { platformPageForRole } from "@/server/platform-roles";

/**
 * A page of Kaizen's that does not exist (or is not published), inside Kaizen's header and footer: Kaizen's own
 * 404 page where one is chosen (D143), else a short message. Shown with a 404 status either way.
 */
export default async function PlatformNotFound() {
  const page = await platformPageForRole("not_found");
  if (page) {
    return (
      <main id="main" className={`w-full flex-1 ${pageRoomClass(page.content, "pt-10", "pb-10")}`}>
        <PageArticle content={page.content} place={{ pageId: page.id, owner: null }} />
      </main>
    );
  }
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">This page does not exist.</h1>
      <Link href="/" className="w-fit underline">
        Kaizen&apos;s front page
      </Link>
    </main>
  );
}
