import Link from "next/link";

/**
 * A stand-in for a Work page that is built in a later step, so the menu's
 * links never lead nowhere. The real page replaces the route's page file.
 */
export function WorkComingSoon({ storeSlug, title }: { storeSlug: string; title: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
        Coming in the next step.{" "}
        <Link href={`/admin/${storeSlug}/work`} className="underline">
          Back to Work
        </Link>
      </p>
    </div>
  );
}
