import { AdminLink } from "../ui";

/** A form's two views (D705): the form itself and its responses (a page of its own for a store, read with the customers). */
export function FormTabs({
  formHref,
  responsesHref,
  current,
  words,
}: {
  formHref: string;
  responsesHref: string;
  current: "form" | "responses";
  words: { form: string; responses: string };
}) {
  const tabs = [
    { key: "form", href: formHref, label: words.form },
    { key: "responses", href: responsesHref, label: words.responses },
  ] as const;
  return (
    <nav aria-label={words.form} className="flex flex-wrap gap-2 text-sm" data-form-tabs>
      {tabs.map((tab) => (
        <AdminLink
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className="rounded px-3 py-1.5 text-ink-2 aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:text-ink"
        >
          {tab.label}
        </AdminLink>
      ))}
    </nav>
  );
}
