import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Camera,
  FolderSearch,
  Lock,
  LogOut,
  Moon,
  Pause,
  Power,
  RotateCcw,
  SquareTerminal,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { navigate, useTheme } from '@/lib/hooks'
import { NAV } from '@/lib/nav'
import { useStats } from '@/lib/stats'
import { downloadUrl } from '@/lib/utils'

interface Action {
  id: string
  label: string
  icon: LucideIcon
  keywords?: string
  run: () => void | Promise<void>
  confirm?: string
}

export function CommandPalette({ open, onOpenChange, onLogout }: { open: boolean; onOpenChange: (o: boolean) => void; onLogout: () => void }) {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<Action | null>(null)
  const { resolved: theme, setTheme } = useTheme()
  const { info } = useStats()

  const power = (action: string, label: string) => async () => {
    try {
      await api.power(action)
      toast.success(`${label} sent to ${info?.hostname ?? 'PC'}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const media = (action: string) => async () => {
    try {
      await api.media(action)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const actions: Action[] = [
    { id: 'shot', label: 'Take screenshot', icon: Camera, keywords: 'capture screen image', run: () => downloadUrl(api.screenshotHref(1), `screenshot-${Date.now()}.png`) },
    { id: 'lock', label: 'Lock PC', icon: Lock, run: power('lock', 'Lock') },
    { id: 'sleep', label: 'Sleep', icon: Moon, keywords: 'suspend', run: power('sleep', 'Sleep'), confirm: 'Put the PC to sleep?' },
    { id: 'restart', label: 'Restart', icon: RotateCcw, keywords: 'reboot', run: power('restart', 'Restart'), confirm: 'Restart the PC? Unsaved work will be lost.' },
    { id: 'shutdown', label: 'Shut down', icon: Power, keywords: 'power off', run: power('shutdown', 'Shut down'), confirm: 'Shut down the PC? You will lose the connection.' },
    { id: 'play', label: 'Play / pause media', icon: Pause, keywords: 'music spotify', run: media('play_pause') },
    { id: 'mute', label: 'Mute / unmute', icon: VolumeX, keywords: 'sound audio', run: media('mute') },
    { id: 'vol', label: 'Volume up', icon: Volume2, keywords: 'sound louder', run: media('volume_up') },
    { id: 'theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, icon: Moon, keywords: 'appearance dark light', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    { id: 'logout', label: 'Sign out', icon: LogOut, keywords: 'logout', run: onLogout },
  ]

  const close = () => {
    onOpenChange(false)
    setQuery('')
    setPending(null)
  }

  const exec = async (a: Action) => {
    if (a.confirm && pending?.id !== a.id) {
      setPending(a)
      return
    }
    close()
    await a.run()
  }

  const looksLikePath = /^([a-zA-Z]:[\\/]|\/|~)/.test(query.trim())

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="card fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden p-0 shadow-2xl outline-none animate-fade-up">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search pages and run actions</DialogPrimitive.Description>
          <Command loop className="flex flex-col" shouldFilter>
            <Command.Input
              value={query}
              onValueChange={(v) => {
                setQuery(v)
                setPending(null)
              }}
              placeholder="Go to a page, run an action, or type a command…"
              className="h-12 w-full border-b border-border bg-transparent px-4 text-[15px] outline-none placeholder:text-fg-subtle"
            />
            {pending && (
              <div className="flex items-center justify-between gap-3 border-b border-border bg-danger/10 px-4 py-2.5 text-[13px]">
                <span>{pending.confirm}</span>
                <span className="text-xs text-fg-muted">Press Enter again to confirm</span>
              </div>
            )}
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5 scrollbar-thin">
              <Command.Empty className="py-8 text-center text-sm text-fg-subtle">No matches.</Command.Empty>
              {query.trim() && (
                <Command.Group heading="Run" className="cmd-group">
                  <Item
                    icon={SquareTerminal}
                    value={`run ${query}`}
                    label={
                      <>
                        Run <code className="font-mono text-accent">{query.trim()}</code> in terminal
                      </>
                    }
                    onSelect={() => {
                      const cmd = query.trim()
                      close()
                      navigate('terminal', cmd)
                    }}
                  />
                  {looksLikePath && (
                    <Item
                      icon={FolderSearch}
                      value={`open ${query}`}
                      label={
                        <>
                          Open <code className="font-mono text-accent">{query.trim()}</code> in Files
                        </>
                      }
                      onSelect={() => {
                        const p = query.trim()
                        close()
                        navigate('files', p)
                      }}
                    />
                  )}
                </Command.Group>
              )}
              <Command.Group heading="Pages" className="cmd-group">
                {NAV.map((n) => (
                  <Item key={n.route} icon={n.icon} value={`${n.label} ${n.hint}`} label={n.label} hint={n.hint} onSelect={() => (close(), navigate(n.route))} />
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className="cmd-group">
                {actions.map((a) => (
                  <Item key={a.id} icon={a.icon} value={`${a.label} ${a.keywords ?? ''}`} label={a.label} danger={!!a.confirm} onSelect={() => exec(a)} />
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Item({
  icon: Icon,
  label,
  hint,
  value,
  onSelect,
  danger,
}: {
  icon: LucideIcon
  label: React.ReactNode
  hint?: string
  value: string
  onSelect: () => void
  danger?: boolean
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-surface-2"
    >
      <Icon className={danger ? 'size-4 text-danger' : 'size-4 text-fg-subtle'} />
      <span className="truncate">{label}</span>
      {hint && <span className="ml-auto hidden truncate text-xs text-fg-subtle sm:block">{hint}</span>}
    </Command.Item>
  )
}
