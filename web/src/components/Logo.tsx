import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('size-8', className)} aria-hidden>
      <defs>
        <linearGradient id="rpc-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--chart-2)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#rpc-logo)" />
      <rect x="11" y="13" width="26" height="17" rx="3" fill="none" stroke="var(--accent-fg)" strokeWidth="2.6" />
      <path d="M19 35h10M24 30v5" stroke="var(--accent-fg)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M17.5 23.5l3.2-3.2 3 2.6 5-5" fill="none" stroke="var(--accent-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
