import Link from "next/link";

/** A page of Kaizen's that does not exist (or is not published), inside Kaizen's header and footer. */
export default function PlatformNotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">This page does not exist.</h1>
      <Link href="/" className="w-fit underline">
        Kaizen&apos;s front page
      </Link>
    </main>
  );
}
