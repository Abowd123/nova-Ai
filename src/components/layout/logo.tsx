import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-9", className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="nova-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7F67BE" />
          <stop offset="100%" stopColor="#4F378B" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#nova-logo-gradient)" />
      <path
        d="M32 12c1.6 9.4 5.6 15.4 12 18-6.4 2.6-10.4 8.6-12 18-1.6-9.4-5.6-15.4-12-18 6.4-2.6 10.4-8.6 12-18z"
        fill="#fff"
      />
    </svg>
  );
}
