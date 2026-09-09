export function TuboMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Tubo"
      focusable="false"
    >
      <defs>
        <linearGradient id="tubo-mark-fill" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a3ffcb" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="rgba(9,24,40,0.9)" stroke="rgba(34,211,238,0.35)" />
      <path
        d="M9 10.5h14M16 10.5v12"
        stroke="url(#tubo-mark-fill)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M10.5 18.5c0 3 2.5 5 5.5 5s5.5-2 5.5-5"
        stroke="url(#tubo-mark-fill)"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.65"
      />
    </svg>
  );
}
