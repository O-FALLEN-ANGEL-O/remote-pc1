import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'danger-soft'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-sm',
  secondary: 'bg-surface-2 text-fg hover:bg-border/60 border border-border',
  outline: 'border border-border bg-transparent hover:bg-surface-2 text-fg',
  ghost: 'bg-transparent hover:bg-surface-2 text-fg-muted hover:text-fg',
  danger: 'bg-danger text-white hover:brightness-110 shadow-sm',
  'danger-soft': 'bg-danger/10 text-danger hover:bg-danger/20',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,filter,color,opacity] select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  )
})

// --------------------------------------------------------------------- Card

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />
}

export function CardHeader({
  title,
  icon,
  action,
  subtitle,
  className,
}: {
  title: ReactNode
  icon?: ReactNode
  action?: ReactNode
  subtitle?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-2 sm:px-5', className)}>
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg-muted [&_svg]:size-4">
          {icon}
          {title}
        </h3>
        {subtitle ? <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

// -------------------------------------------------------------------- Badge

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
  className?: string
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-surface-2 text-fg-muted border-border',
    accent: 'bg-accent-soft text-accent border-transparent',
    ok: 'bg-ok/12 text-ok border-transparent',
    warn: 'bg-warn/15 text-warn border-transparent',
    danger: 'bg-danger/12 text-danger border-transparent',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3', tones[tone], className)}>
      {children}
    </span>
  )
}

// -------------------------------------------------------------------- Input

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(
  function Input({ className, icon, ...props }, ref) {
    const input = (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-lg border border-border bg-bg-subtle px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors outline-none focus:border-accent focus:ring-2 focus:ring-ring/40',
          icon ? 'pl-9' : '',
          className,
        )}
        {...props}
      />
    )
    if (!icon) return input
    return (
      <div className="relative w-full">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle [&_svg]:size-4">{icon}</span>
        {input}
      </div>
    )
  },
)

// ------------------------------------------------------------------- Switch

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border-strong',
      )}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  )
}

// --------------------------------------------------------------- Segmented

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-lg border border-border bg-bg-subtle p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-md font-medium text-fg-muted transition-colors hover:text-fg [&_svg]:size-3.5',
            size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
            value === o.value && 'bg-surface text-fg shadow-sm dark:bg-surface-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// -------------------------------------------------------------------- Meter

export function Meter({ value, color, className, label }: { value: number; color?: string; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-border/70', className)}
    >
      <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${v}%`, background: color ?? 'var(--accent)' }} />
    </div>
  )
}

// ---------------------------------------------------------- misc helpers

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-border/60', className)} />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-fg-subtle', className)} />
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-1 rounded-xl bg-surface-2 p-3 text-fg-subtle [&_svg]:size-6">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="max-w-sm text-[13px] text-fg-muted">{children}</div> : null}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">{children}</kbd>
}

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'danger' | 'idle' }) {
  const c = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', idle: 'bg-fg-subtle' }[tone]
  return (
    <span className="relative inline-flex size-2">
      {tone === 'ok' ? <span className={cn('absolute inset-0 rounded-full opacity-60 animate-pulse-dot', c)} /> : null}
      <span className={cn('relative inline-flex size-2 rounded-full', c)} />
    </span>
  )
}
