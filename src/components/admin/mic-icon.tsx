/**
 * The microphone: on the launcher's Talk button and in the AI manager's composer. A module of its own so the launcher, on every admin
 * screen, draws it without the chat, which loads when the panel is first opened.
 */
export function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
