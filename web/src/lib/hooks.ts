import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { storage, store } from './utils'

// ------------------------------------------------------------------ routing

export const ROUTES = ['overview', 'screen', 'terminal', 'files', 'processes', 'system', 'controls', 'activity', 'settings'] as const
export type Route = (typeof ROUTES)[number]

function readRoute(): { route: Route; param: string } {
  const raw = location.hash.replace(/^#\/?/, '')
  if (raw.startsWith('token=')) return { route: 'overview', param: '' }
  const [name, ...rest] = raw.split('/')
  const route = (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'overview'
  return { route, param: decodeURIComponent(rest.join('/')) }
}

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash)
  void hash
  return readRoute()
}

export function navigate(route: Route, param?: string) {
  location.hash = `/${route}${param ? '/' + encodeURIComponent(param) : ''}`
}

// -------------------------------------------------------------------- theme

export type Theme = 'dark' | 'light' | 'system'

// Shared theme store so every component sees the same value.
let currentTheme: Theme = storage<Theme>('rpc.theme', 'dark')
const themeListeners = new Set<() => void>()

function applyTheme() {
  const dark = currentTheme === 'dark' || (currentTheme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0b0d' : '#fafbfc')
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentTheme === 'system') {
    applyTheme()
    themeListeners.forEach((l) => l())
  }
})

export function setTheme(t: Theme) {
  currentTheme = t
  try {
    localStorage.setItem('rpc.theme', t)
  } catch {
    /* ignore */
  }
  applyTheme()
  themeListeners.forEach((l) => l())
}

export function resolvedTheme(): 'dark' | 'light' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb)
      return () => themeListeners.delete(cb)
    },
    () => currentTheme,
  )
  const resolved = theme === 'system' ? resolvedTheme() : theme
  return { theme, resolved, setTheme }
}

// ------------------------------------------------------------ persisted state

export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => storage<T>(key, initial))
  useEffect(() => store(key, value), [key, value])
  return [value, setValue] as const
}

// ---------------------------------------------------------------- websocket

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'unauthorized'

/**
 * Reconnecting WebSocket. `onMessage` always sees the latest closure.
 * Pass url=null to stay disconnected.
 */
export function useSocket(
  url: string | null,
  onMessage: (ev: MessageEvent) => void,
  opts: { binaryType?: BinaryType; onOpen?: (ws: WebSocket) => void } = {},
) {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const handler = useRef(onMessage)
  const onOpen = useRef(opts.onOpen)
  handler.current = onMessage
  onOpen.current = opts.onOpen

  useEffect(() => {
    if (!url) {
      setStatus('closed')
      return
    }
    let closed = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      setStatus('connecting')
      const ws = new WebSocket(url)
      if (opts.binaryType) ws.binaryType = opts.binaryType
      wsRef.current = ws
      ws.onopen = () => {
        retry = 0
        setStatus('open')
        onOpen.current?.(ws)
      }
      ws.onmessage = (ev) => handler.current(ev)
      ws.onclose = (ev) => {
        wsRef.current = null
        if (closed) return
        if (ev.code === 4401) {
          setStatus('unauthorized')
          return
        }
        setStatus('closed')
        retry = Math.min(retry + 1, 6)
        timer = setTimeout(connect, 500 * 2 ** retry)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      wsRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data))
  }, [])

  return { status, send, socket: wsRef }
}

// --------------------------------------------------------------- misc hooks

export function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    if (ms == null) return
    const id = setInterval(() => saved.current(), ms)
    return () => clearInterval(id)
  }, [ms])
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
  )
}

/** Run an async loader, exposing data / error / loading and a reload(). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setState((s) => ({ ...s, loading: true }))
    try {
      const data = await fnRef.current()
      setState({ data, loading: false })
      return data
    } catch (error) {
      setState((s) => ({ ...s, error: error as Error, loading: false }))
    }
  }, [])
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { ...state, reload, setData: (data: T) => setState({ data, loading: false }) }
}
