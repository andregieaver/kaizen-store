/** A plain lettermark for an integration: its initial on its own colour (no borrowed logos). */
const TONES: Record<string, string> = {
  zapier: "bg-orange-600 text-white",
  make: "bg-violet-700 text-white",
  tripletex: "bg-sky-800 text-white",
};

export function IntegrationMark({ id }: { id: string }) {
  return (
    <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-lg text-lg font-semibold ${TONES[id] ?? "bg-surface"}`}>
      {id.charAt(0).toUpperCase()}
    </span>
  );
}
