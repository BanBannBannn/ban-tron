export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="11" fill="var(--color-accent)" />
      <circle cx="20" cy="20" r="10.5" fill="none" stroke="white" strokeWidth="2.6" />
      <circle cx="20" cy="9.5" r="3.4" fill="#ffd43b" stroke="var(--color-accent)" strokeWidth="1.6" />
      <circle cx="29.6" cy="25.4" r="3.4" fill="#ff8787" stroke="var(--color-accent)" strokeWidth="1.6" />
      <circle cx="10.4" cy="25.4" r="3.4" fill="#69db7c" stroke="var(--color-accent)" strokeWidth="1.6" />
    </svg>
  );
}
