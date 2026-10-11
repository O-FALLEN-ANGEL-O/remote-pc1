import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Minus, Plus, SquareTerminal, X, ClipboardPaste, Eraser } from 'lucide-react'
import { toast } from 'sonner'
import { api, wsUrl } from '@/lib/api'
import { useAsync, usePersistentState, useTheme } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/primitives'

const DARK: ITheme = {
  background: '#0d0e11',
  foreground: '#e6e8ec',
  cursor: '#67e8f9',
  cursorAccent: '#0d0e11',
  selectionBackground: '#67e8f940',
  black: '#1b1d22', red: '#f87171', green: '#4ade80', yellow: '#facc15', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d4d4d8',
  brightBlack: '#52525b', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde047', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#fafafa',
}
const LIGHT: ITheme = {
  background: '#fbfbfc',
  foreground: '#1f2328',
  cursor: '#0891b2',
  cursorAccent: '#fbfbfc',
  selectionBackground: '#0891b230',
  black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#0e7490', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#0891b2', brightWhite: '#8c959f',
}

interface Session {
  id: number
  shell: string
  title: string
  initial?: string
}

let nextId = 1

function TerminalView({
  session,
  active,
  fontSize,
  onExit,
  registerApi,
}: {
  session: Session
  active: boolean
  fontSize: number
  onExit: () => void
  registerApi: (id: number, api: { send: (d: string) => void; clear: () => void; focus: () => void } | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const { resolved } = useTheme()

  useEffect(() => {
    const t = new XTerm({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, Menlo, monospace',
      fontSize,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: document.documentElement.classList.contains('dark') ? DARK : LIGHT,
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon())
    t.open(host.current!)
    term.current = t
    fit.current = f
    try {
      f.fit()
    } catch {
      /* not visible yet */
    }

    const socket = new WebSocket(wsUrl('/ws/terminal', { cols: t.cols, rows: t.rows, shell: session.shell }))
    ws.current = socket
    const send = (data: string) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'input', data }))
    socket.onopen = () => {
      if (session.initial) setTimeout(() => send(session.initial + '\r'), 400)
    }
    socket.onmessage = (ev) => t.write(ev.data)
    socket.onclose = (ev) => {
      if (ev.code === 4401) t.write('\r\n\x1b[31mSession expired — sign in again.\x1b[0m\r\n')
      else t.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n')
    }
    const d1 = t.onData(send)
    const d2 = t.onResize(({ cols, rows }) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'resize', cols, rows })))
    const d3 = t.onTitleChange(() => {})
    // Ctrl+Shift+C / Ctrl+Shift+V for copy/paste, like desktop terminals.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        const sel = t.getSelection()
        if (sel) navigator.clipboard?.writeText(sel).catch(() => {})
        return false
      }
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        navigator.clipboard?.readText().then(send).catch(() => {})
        return false
      }
      return true
    })
    registerApi(session.id, { send, clear: () => t.clear(), focus: () => t.focus() })

    const ro = new ResizeObserver(() => {
      try {
        f.fit()
      } catch {
        /* hidden */
      }
    })
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      d1.dispose()
      d2.dispose()
      d3.dispose()
      socket.onclose = null
      socket.close()
      t.dispose()
      registerApi(session.id, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  useEffect(() => {
    if (!term.current) return
    term.current.options.fontSize = fontSize
    try {
      fit.current?.fit()
    } catch {
      /* hidden */
    }
  }, [fontSize])

  useEffect(() => {
    if (term.current) term.current.options.theme = resolved === 'dark' ? DARK : LIGHT
  }, [resolved])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        try {
          fit.current?.fit()
        } catch {
          /* hidden */
        }
        term.current?.focus()
      })
    }
  }, [active])

  void onExit
  return <div ref={host} className={cn('absolute inset-0', !active && 'invisible')} />
}

export default function Terminal({ initialCommand }: { initialCommand?: string }) {
  const settings = useAsync(() => api.settings(), [])
  const shells = settings.data?.shells ?? []
  const [shell, setShell] = usePersistentState('rpc.term.shell', '')
  const [fontSize, setFontSize] = usePersistentState('rpc.term.font', 14)
  const [sessions, setSessions] = useState<Session[]>([])
  const [active, setActive] = useState<number>(0)
  const apis = useRef(new Map<number, { send: (d: string) => void; clear: () => void; focus: () => void }>())
  const handledInitial = useRef<string | undefined>(undefined)
  const openedFirst = useRef(false)

  const effectiveShell = shells.some((s) => s.id === shell) ? shell : shells[0]?.id ?? ''

  const open = (initial?: string) => {
    const name = shells.find((s) => s.id === effectiveShell)?.name ?? 'Shell'
    const s: Session = { id: nextId++, shell: effectiveShell, title: name, initial }
    setSessions((prev) => [...prev, s])
    setActive(s.id)
  }

  useEffect(() => {
    if (!settings.data) return
    if (initialCommand && handledInitial.current !== initialCommand) {
      handledInitial.current = initialCommand
      const current = apis.current.get(active)
      if (current) {
        current.send(initialCommand + '\r')
        current.focus()
      } else {
        openedFirst.current = true
        open(initialCommand)
      }
      history.replaceState(null, '', '#/terminal')
      return
    }
    if (!openedFirst.current) {
      openedFirst.current = true
      open()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data, initialCommand])

  const close = (id: number) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (active === id) setActive(next[next.length - 1]?.id ?? 0)
      return next
    })
  }

  const extraKeys: [string, string][] = [
    ['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['Ctrl+D', '\x04'], ['Ctrl+L', '\x0c'],
    ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['|', '|'], ['~', '~'], ['/', '/'],
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0d0e11] sm:rounded-[14px] sm:border sm:border-border [html:not(.dark)_&]:bg-[#fbfbfc]">
      <div className="flex items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-thin" role="tablist">
          {sessions.map((s, i) => (
            <div
              key={s.id}
              role="tab"
              aria-selected={active === s.id}
              className={cn(
                'group flex h-8 shrink-0 items-center gap-2 rounded-lg pr-1 pl-3 text-[13px] text-fg-muted',
                active === s.id ? 'bg-surface-2 text-fg' : 'hover:bg-surface-2/60',
              )}
            >
              <button className="flex items-center gap-2" onClick={() => setActive(s.id)}>
                <SquareTerminal className="size-3.5 text-accent" />
                {s.title} {sessions.length > 1 ? i + 1 : ''}
              </button>
              <button
                onClick={() => close(s.id)}
                className="rounded p-0.5 text-fg-subtle opacity-60 hover:bg-border hover:text-fg group-hover:opacity-100"
                aria-label={`Close ${s.title}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <Button size="icon-sm" variant="ghost" onClick={() => open()} aria-label="New terminal" title="New terminal">
            <Plus />
          </Button>
        </div>
        {shells.length > 1 && (
          <select
            aria-label="Shell for new tabs"
            value={effectiveShell}
            onChange={(e) => setShell(e.target.value)}
            className="hidden h-8 rounded-lg border border-border bg-bg-subtle px-2 text-xs sm:block"
          >
            {shells.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <Button size="icon-sm" variant="ghost" title="Paste" aria-label="Paste" onClick={() => navigator.clipboard?.readText().then((t) => apis.current.get(active)?.send(t)).catch(() => toast.error('Clipboard blocked by the browser'))}>
          <ClipboardPaste />
        </Button>
        <Button size="icon-sm" variant="ghost" title="Clear" aria-label="Clear" onClick={() => apis.current.get(active)?.clear()}>
          <Eraser />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Smaller text" onClick={() => setFontSize((f) => Math.max(10, f - 1))}>
          <Minus />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Larger text" onClick={() => setFontSize((f) => Math.min(24, f + 1))}>
          <Plus />
        </Button>
      </div>
      <div className="relative min-h-[50vh] flex-1">
        {sessions.map((s) => (
          <TerminalView
            key={s.id}
            session={s}
            active={active === s.id}
            fontSize={fontSize}
            onExit={() => close(s.id)}
            registerApi={(id, a) => (a ? apis.current.set(id, a) : apis.current.delete(id))}
          />
        ))}
        {sessions.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-fg-subtle">
            <SquareTerminal className="size-8" />
            <Button variant="primary" onClick={() => open()} disabled={!settings.data}>
              New terminal
            </Button>
          </div>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto border-t border-border bg-surface px-2 py-1.5 scrollbar-thin lg:hidden">
        {extraKeys.map(([label, seq]) => (
          <button
            key={label}
            onClick={() => {
              const a = apis.current.get(active)
              a?.send(seq)
              a?.focus()
            }}
            className="h-8 shrink-0 rounded-md border border-border bg-bg-subtle px-2.5 font-mono text-xs"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
