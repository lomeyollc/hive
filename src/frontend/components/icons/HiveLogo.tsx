/**
 * Hive mark: a hexagon (the hive/board) containing three cells (agents and
 * you, working the same board). Stroke-based to match lucide-react's 24x24
 * grid so it drops in anywhere a lucide icon was used (className size-N).
 */
export function HiveLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 13L16 19.93H8L4 13L8 6.07H16L20 13Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="1.3" fill="#F5A623" />
      <circle cx="9.3" cy="15" r="1.3" fill="#F5A623" />
      <circle cx="14.7" cy="15" r="1.3" fill="#F5A623" />
    </svg>
  );
}
