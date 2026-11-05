/** A plain lettermark for an integration: its initial on its own colour (no borrowed logos). */
const TONES: Record<string, string> = {
  zapier: "bg-orange-600 text-white",
  make: "bg-violet-700 text-white",
  slack: "bg-fuchsia-900 text-white",
  tripletex: "bg-sky-800 text-white",
  fiken: "bg-indigo-700 text-white",
  bring: "bg-red-700 text-white",
  postnord: "bg-blue-700 text-white",
  porterbuddy: "bg-emerald-700 text-white",
  helthjem: "bg-amber-600 text-white",
  instabox: "bg-pink-700 text-white",
  ups: "bg-yellow-900 text-white",
  dhl: "bg-yellow-400 text-red-800",
  dhl_paket: "bg-red-700 text-yellow-300",
  nshift: "bg-teal-800 text-white",
  sendcloud: "bg-cyan-800 text-white",
};

export function IntegrationMark({ id }: { id: string }) {
  return (
    <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-lg text-lg font-medium ${TONES[id] ?? "bg-surface"}`}>
      {id.charAt(0).toUpperCase()}
    </span>
  );
}
