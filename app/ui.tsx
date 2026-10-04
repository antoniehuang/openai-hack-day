export const hexButton =
  "clip-angled font-display font-bold uppercase tracking-[0.2em] text-abyss bg-[linear-gradient(180deg,#f0e6d2_0%,#c8aa6e_30%,#c89b3c_60%,#785a28_100%)] bg-[length:100%_200%] bg-top shadow-[0_0_18px_rgb(200_155_60/0.35)] transition hover:bg-bottom hover:shadow-[0_0_28px_rgb(200_155_60/0.6)] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[linear-gradient(180deg,#2a3140_0%,#1e2328_100%)] disabled:text-parchment disabled:shadow-none";

export function HexGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 100 100" fill="none" stroke="currentColor" className={className}>
      <path d="M50 4 90 27v46L50 96 10 73V27z" strokeWidth="3" />
      <path d="M50 22 74 36v28L50 78 26 64V36z" strokeWidth="2" opacity="0.6" />
      <circle cx="50" cy="50" r="6" fill="currentColor" opacity="0.8" />
    </svg>
  );
}
