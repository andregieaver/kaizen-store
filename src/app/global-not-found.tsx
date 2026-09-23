import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "404 · Kaizen Store",
};

export default function GlobalNotFound() {
  return (
    <html lang="nb" className="h-full antialiased">
      <body className="flex min-h-full flex-col items-center justify-center gap-4 p-6 font-sans">
        <h1 className="text-2xl font-semibold">404</h1>
        <p>
          <span lang="nb">Siden finnes ikke.</span> ·{" "}
          <span lang="sv">Sidan finns inte.</span> ·{" "}
          <span lang="da">Siden findes ikke.</span>
        </p>
        <Link href="/" className="underline">
          Kaizen Store
        </Link>
      </body>
    </html>
  );
}
