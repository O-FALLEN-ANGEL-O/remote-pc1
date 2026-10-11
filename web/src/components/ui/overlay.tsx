import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './primitives'

// ------------------------------------------------------------------- Dialog

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-up" />
        <DialogPrimitive.Content
          className={cn(
            'card fixed top-1/2 left-1/2 z-50 flex max-h-[min(88dvh,900px)] w-[calc(100vw-24px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden p-0 shadow-2xl outline-none',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-[15px] font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] text-fg-muted">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-auto px-5 py-4 scrollbar-thin">{children}</div> : null}
          {footer ? <div className="flex justify-end gap-2 border-t border-border bg-bg-subtle/60 px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Confirmation dialog hook: `const [confirm, node] = useConfirm()` then `await confirm({...})`. */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string
    body?: ReactNode
    confirmLabel?: string
    danger?: boolean
    resolve: (v: boolean) => void
  } | null>(null)

  const confirm = (opts: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }))

  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }

  const node = (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ''}
      description={state?.body}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {state?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  )
  return [confirm, node] as const
}

// --------------------------------------------------------------------- Menu

export function DropdownMenu({
  trigger,
  children,
  align = 'end',
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end' | 'center'
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={6}
          className="card z-50 min-w-[200px] p-1 shadow-xl data-[state=open]:animate-fade-up"
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

export function MenuItem({
  children,
  onSelect,
  danger,
  icon,
  disabled,
}: {
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  icon?: ReactNode
  disabled?: boolean
}) {
  return (
    <Menu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-fg-subtle',
        danger && 'text-danger [&_svg]:text-danger',
      )}
    >
      {icon}
      {children}
    </Menu.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Menu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{children}</Menu.Label>
}

export function MenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />
}
