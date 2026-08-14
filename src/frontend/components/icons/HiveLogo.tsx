/**
 * Hive mark: a solid amber hexagon (the hive/board). Kept deliberately
 * simple — a bolder, higher-contrast single shape reads clearly even at
 * 16px (browser tab favicon size), where the earlier thin-outline +
 * three-dot version blurred into a smudge. Matches .github/logo.png and
 * the generated favicon/apple-touch-icon exactly.
 */
export function HiveLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M17 6.5H7L2 12l5 5.5h10l5-5.5z" fill="#F5A623" />
    </svg>
  );
}
