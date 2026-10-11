import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Camera,
  ClipboardPaste,
  Keyboard,
  Maximize,
  Minimize,
  MonitorPlay,
  MousePointer2,
  Pause,
  Play,
  Eye,
  Command as CommandIcon,
} from 'lucide-react'
import { api, wsUrl } from '@/lib/api'
import { useAsync, usePersistentState, useSocket } from '@/lib/hooks'
import type { Monitor } from '@/lib/types'
import { cn, downloadUrl, formatBytes } from '@/lib/utils'
import { Button, Input, Segmented, StatusDot } from '@/components/ui/primitives'
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/overlay'

const PRESETS = {
  low: { scale: 0.5, quality: 40, fps: 8 },
  balanced: { scale: 0.75, quality: 60, fps: 12 },
  high: { scale: 1, quality: 80, fps: 20 },
} as const
type Preset = keyof typeof PRESETS

const COMBOS: { label: string; keys: string[] }[] = [
  { label: 'Start menu (Win)', keys: ['win'] },
  { label: 'Switch app (Alt+Tab)', keys: ['alt', 'tab'] },
  { label: 'Show desktop (Win+D)', keys: ['win', 'd'] },
  { label: 'Task Manager (Ctrl+Shift+Esc)', keys: ['ctrl', 'shift', 'esc'] },
  { label: 'Close window (Alt+F4)', keys: ['alt', 'F4'] },
  { label: 'Copy (Ctrl+C)', keys: ['ctrl', 'c'] },
  { label: 'Paste (Ctrl+V)', keys: ['ctrl', 'v'] },
  { label: 'Undo (Ctrl+Z)', keys: ['ctrl', 'z'] },
  { label: 'Select all (Ctrl+A)', keys: ['ctrl', 'a'] },
  { label: 'Lock (Win+L)', keys: ['win', 'l'] },
]

const BUTTONS = ['left', 'middle', 'right'] as const

export default function Screen() {
  const monitors = useAsync(() => api.monitors(), [])
  const [monitor, setMonitor] = usePersistentState('rpc.screen.monitor', 1)
  const [preset, setPreset] = usePersistentState<Preset>('rpc.screen.preset', 'balanced')
  const [control, setControl] = usePersistentState('rpc.screen.control', false)
  const [paused, setPaused] = useState(false)
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null)
  const [fps, setFps] = useState(0)
  const [bps, setBps] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [showKeyboard, setShowKeyboard] = useState(false)
  const [typed, setTyped] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const counters = useRef({ frames: 0, bytes: 0 })
  const meta = useRef<{ width: number; height: number } | null>(null)
  const drawing = useRef(false)

  // ------------------------------------------------------------- stream

  const config = useCallback(
    () => ({ type: 'config', monitor, paused, ...PRESETS[preset] }),
    [monitor, paused, preset],
  )
  const configRef = useRef(config)
  configRef.current = config

  const stream = useSocket(
    wsUrl('/ws/screen'),
    async (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'frame') meta.current = { width: msg.width, height: msg.height }
        if (msg.type === 'error') setStreamError(msg.message)
        return
      }
      const buf = ev.data as ArrayBuffer
      counters.current.frames++
      counters.current.bytes += buf.byteLength
      if (drawing.current) return // drop frames rather than queue them
      drawing.current = true
      try {
        const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }))
        const c = canvasRef.current
        if (c) {
          if (c.width !== bmp.width || c.height !== bmp.height) {
            c.width = bmp.width
            c.height = bmp.height
          }
          c.getContext('2d')?.drawImage(bmp, 0, 0)
          const m = meta.current
          if (m) setFrame((f) => (f && f.w === m.width && f.h === m.height ? f : { w: m.width, h: m.height }))
        }
        bmp.close()
      } finally {
        drawing.current = false
      }
    },
    { binaryType: 'arraybuffer', onOpen: (ws) => ws.send(JSON.stringify(configRef.current())) },
  )

  const sendStream = stream.send
  useEffect(() => {
    sendStream(config())
  }, [config, sendStream])

  useEffect(() => {
    const id = setInterval(() => {
      setFps(counters.current.frames)
      setBps(counters.current.bytes)
      counters.current = { frames: 0, bytes: 0 }
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // -------------------------------------------------------------- input

  const input = useSocket(control ? wsUrl('/ws/input') : null, (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.type === 'error') {
      toast.error(msg.message)
      if (String(msg.message).includes('unavailable')) setControl(false)
    }
  }, { onOpen: (ws) => ws.send(JSON.stringify({ type: 'monitor', monitor })) })

  const sendInput = input.send
  useEffect(() => {
    sendInput({ type: 'monitor', monitor })
  }, [monitor, sendInput])

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const pending = useRef<{ x: number; y: number } | null>(null)
  const raf = useRef(0)
  const queueMove = (p: { x: number; y: number }) => {
    pending.current = p
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      if (pending.current) input.send({ type: 'move', ...pending.current })
    })
  }

  // touch: tap = click, long-press = right click, drag = drag, two fingers = scroll
  const touch = useRef<{ id: number; x: number; y: number; t: number; moved: boolean; timer?: ReturnType<typeof setTimeout>; down: boolean } | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  const onPointerDown = (e: React.PointerEvent) => {
    if (!control) return
    stageRef.current?.focus({ preventScroll: true })
    const p = pos(e)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    if (e.pointerType === 'touch') {
      if (pointers.current.size > 1) {
        if (touch.current?.timer) clearTimeout(touch.current.timer)
        touch.current = null
        return
      }
      const t = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), moved: false, down: false } as NonNullable<typeof touch.current>
      t.timer = setTimeout(() => {
        if (touch.current === t && !t.moved) {
          input.send({ type: 'click', button: 'right', ...p })
          navigator.vibrate?.(15)
          touch.current = null
        }
      }, 550)
      touch.current = t
      return
    }
    e.preventDefault()
    input.send({ type: 'down', button: BUTTONS[e.button] ?? 'left', ...p })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!control || !canvasRef.current) return
    if (e.pointerType === 'touch') {
      const prev = pointers.current.get(e.pointerId)
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 2 && prev) {
        const dy = e.clientY - prev.y
        if (Math.abs(dy) > 2) input.send({ type: 'scroll', dx: 0, dy: dy > 0 ? 1 : -1 })
        return
      }
      const t = touch.current
      if (!t || t.id !== e.pointerId) return
      if (!t.moved && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) {
        t.moved = true
        clearTimeout(t.timer)
        input.send({ type: 'down', button: 'left', ...pos({ clientX: t.x, clientY: t.y }) })
        t.down = true
      }
      if (t.moved) queueMove(pos(e))
      return
    }
    queueMove(pos(e))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (!control) return
    const p = pos(e)
    if (e.pointerType === 'touch') {
      const t = touch.current
      if (!t || t.id !== e.pointerId) return
      clearTimeout(t.timer)
      if (t.down) input.send({ type: 'up', button: 'left', ...p })
      else input.send({ type: 'click', button: 'left', ...p })
      touch.current = null
      return
    }
    input.send({ type: 'up', button: BUTTONS[e.button] ?? 'left', ...p })
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!control) return
    const steps = (d: number) => (d === 0 ? 0 : Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 100)))
    input.send({ type: 'scroll', dx: steps(e.deltaX), dy: -steps(e.deltaY) })
  }

  const held = useRef(new Set<string>())
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!control) return
    e.preventDefault()
    if (e.repeat && e.key.length > 1 && !['Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    held.current.add(e.key)
    input.send({ type: 'keydown', key: e.key })
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (!control) return
    e.preventDefault()
    held.current.delete(e.key)
    input.send({ type: 'keyup', key: e.key })
  }
  const onBlur = () => {
    held.current.forEach((k) => input.send({ type: 'keyup', key: k }))
    held.current.clear()
  }

  // ------------------------------------------------------- fullscreen

  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else stageRef.current?.parentElement?.requestFullscreen?.().catch(() => toast.error('Fullscreen not available'))
  }

  const pasteToPc = async () => {
    try {
      const text = await navigator.clipboard.readText()
      await api.setClipboard(text)
      if (control) input.send({ type: 'combo', keys: ['ctrl', 'v'] })
      toast.success(control ? 'Pasted on the PC' : 'Copied to the PC clipboard')
    } catch {
      toast.error('Browser blocked clipboard access. Use Controls → Clipboard instead.')
    }
  }

  const mons: Monitor[] = monitors.data ?? []
  const live = stream.status === 'open' && !paused && fps > 0
  const idle = stream.status === 'open' && !paused && fps === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg sm:rounded-[14px] sm:border sm:border-border sm:bg-surface">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="mr-1 flex items-center gap-2 text-[13px]">
          <StatusDot tone={stream.status !== 'open' ? 'danger' : paused ? 'idle' : 'ok'} />
          <span className="font-medium">{stream.status !== 'open' ? 'Connecting…' : paused ? 'Paused' : live || idle ? 'Live' : '…'}</span>
          <span className="hidden font-mono text-xs text-fg-subtle tabular sm:inline">
            {fps} fps · {formatBytes(bps)}/s{frame ? ` · ${frame.w}×${frame.h}` : ''}
          </span>
        </div>

        <Segmented
          size="sm"
          value={control ? 'control' : 'view'}
          onChange={(v) => setControl(v === 'control')}
          options={[
            { value: 'view', label: (<><Eye /> <span className="hidden sm:inline">View</span></>), title: 'View only' },
            { value: 'control', label: (<><MousePointer2 /> <span className="hidden sm:inline">Control</span></>), title: 'Control mouse and keyboard' },
          ]}
        />

        {mons.length > 1 && (
          <select
            aria-label="Display"
            value={monitor}
            onChange={(e) => setMonitor(Number(e.target.value))}
            className="h-8 rounded-lg border border-border bg-bg-subtle px-2 text-xs"
          >
            {mons.map((m) => (
              <option key={m.index} value={m.index}>
                {m.name} ({m.width}×{m.height})
              </option>
            ))}
          </select>
        )}

        <Segmented
          size="sm"
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'low', label: 'Low', title: 'Low bandwidth' },
            { value: 'balanced', label: 'Auto', title: 'Balanced' },
            { value: 'high', label: 'HD', title: 'Full resolution' },
          ]}
        />

        <div className="ml-auto flex items-center gap-1">
          {control && (
            <>
              <Button size="icon-sm" variant={showKeyboard ? 'secondary' : 'ghost'} onClick={() => setShowKeyboard((s) => !s)} aria-label="Type text" title="Type text">
                <Keyboard />
              </Button>
              <DropdownMenu
                trigger={
                  <Button size="icon-sm" variant="ghost" aria-label="Send key combination" title="Send key combination">
                    <CommandIcon />
                  </Button>
                }
              >
                <MenuLabel>Send keys</MenuLabel>
                {COMBOS.map((c) => (
                  <MenuItem key={c.label} onSelect={() => input.send({ type: 'combo', keys: c.keys })}>
                    {c.label}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem icon={<ClipboardPaste />} onSelect={pasteToPc}>
                  Paste my clipboard on the PC
                </MenuItem>
              </DropdownMenu>
            </>
          )}
          <Button size="icon-sm" variant="ghost" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => downloadUrl(api.screenshotHref(monitor), `screenshot-${Date.now()}.png`)}
            aria-label="Download screenshot"
            title="Download full-quality screenshot"
          >
            <Camera />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen">
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
        </div>
      </div>

      {showKeyboard && control && (
        <form
          className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed) input.send({ type: 'text', text: typed })
            setTyped('')
          }}
        >
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type here, then Send…" className="h-8 min-w-0 flex-1 basis-48" autoFocus />
          <Button type="submit" size="sm" variant="primary">
            Send
          </Button>
          {['Enter', 'Backspace', 'Tab', 'Escape'].map((k) => (
            <Button key={k} type="button" size="sm" variant="outline" onClick={() => input.send({ type: 'key', key: k })}>
              {k === 'Escape' ? 'Esc' : k === 'Backspace' ? '⌫' : k}
            </Button>
          ))}
        </form>
      )}

      {/* stage */}
      <div className="relative flex min-h-[50vh] flex-1 items-center justify-center overflow-hidden bg-[#050506] p-0 sm:rounded-b-[14px]">
        <div
          ref={stageRef}
          tabIndex={0}
          data-capture-keys={control ? '' : undefined}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={onBlur}
          aria-label={control ? 'Remote screen. Keyboard and mouse input is sent to the PC.' : 'Remote screen (view only)'}
          className={cn('flex h-full max-h-[calc(100dvh-170px)] w-full items-center justify-center outline-none', fullscreen && 'max-h-none')}
        >
          <canvas
            ref={canvasRef}
            className={cn('block max-h-full max-w-full select-none', control ? 'cursor-default touch-none' : 'cursor-default', !frame && 'opacity-0')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onContextMenu={(e) => control && e.preventDefault()}
          />
        </div>
        {!frame && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-sm text-fg-subtle">
            <MonitorPlay className="size-8" />
            {streamError ? <p className="max-w-sm text-danger">{streamError}</p> : <p>Waiting for the first frame…</p>}
          </div>
        )}
        {control && frame && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/80 backdrop-blur">
            Controlling · click the screen to send keys
          </div>
        )}
      </div>
    </div>
  )
}
