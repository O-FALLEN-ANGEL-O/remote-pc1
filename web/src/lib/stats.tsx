import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, wsUrl } from './api'
import { useSocket, type SocketStatus } from './hooks'
import type { Alerts, HistoryPoint, StatsSnapshot, SystemInfo } from './types'

interface StatsContextValue {
  stats: StatsSnapshot | null
  history: HistoryPoint[]
  info: SystemInfo | null
  status: SocketStatus
  alerts: Alerts | null
  setAlerts: (a: Alerts) => void
  activeAlerts: string[]
}

const StatsContext = createContext<StatsContextValue | null>(null)
const MAX_POINTS = 120

function notify(title: string, body: string) {
  toast.warning(title, { description: body })
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, icon: '/icon-192.png', tag: title })
    }
  } catch {
    /* notifications unavailable */
  }
}

export function StatsProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<StatsSnapshot | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [alerts, setAlerts] = useState<Alerts | null>(null)
  const [activeAlerts, setActiveAlerts] = useState<string[]>([])
  const strikes = useRef<Record<string, number>>({})
  const firing = useRef<Set<string>>(new Set())

  useEffect(() => {
    api.info().then(setInfo).catch(() => {})
    api.history().then((h) => setHistory(h.slice(-MAX_POINTS))).catch(() => {})
    api.settings().then((s) => setAlerts(s.alerts)).catch(() => {})
  }, [])

  const evaluate = useCallback(
    (s: StatsSnapshot) => {
      if (!alerts?.enabled) {
        if (firing.current.size) {
          firing.current.clear()
          setActiveAlerts([])
        }
        return
      }
      const checks: [string, boolean, boolean, string, string][] = []
      checks.push(['cpu', s.cpu.percent >= alerts.cpu, s.cpu.percent < alerts.cpu - 5, 'CPU usage is high', `CPU at ${s.cpu.percent.toFixed(0)}% (limit ${alerts.cpu}%)`])
      checks.push(['memory', s.memory.percent >= alerts.memory, s.memory.percent < alerts.memory - 5, 'Memory is running low', `Memory at ${s.memory.percent.toFixed(0)}% (limit ${alerts.memory}%)`])
      for (const d of s.disks) {
        checks.push([`disk:${d.mount}`, d.percent >= alerts.disk, d.percent < alerts.disk - 1, `Disk ${d.mount} is nearly full`, `${d.percent.toFixed(0)}% used (limit ${alerts.disk}%)`])
      }
      if (s.battery && !s.battery.plugged) {
        checks.push(['battery', s.battery.percent <= alerts.battery, s.battery.percent > alerts.battery + 3, 'Battery is low', `${s.battery.percent.toFixed(0)}% remaining`])
      } else if (firing.current.has('battery')) {
        checks.push(['battery', false, true, '', ''])
      }
      let changed = false
      for (const [key, over, clear, title, body] of checks) {
        if (over) {
          strikes.current[key] = (strikes.current[key] ?? 0) + 1
          // CPU spikes are normal: require it to stay high for ~5 samples.
          const needed = key === 'cpu' ? 5 : 2
          if (strikes.current[key] >= needed && !firing.current.has(key)) {
            firing.current.add(key)
            changed = true
            notify(title, body)
          }
        } else {
          strikes.current[key] = 0
          if (clear && firing.current.delete(key)) changed = true
        }
      }
      if (changed) setActiveAlerts([...firing.current])
    },
    [alerts],
  )

  const { status } = useSocket(wsUrl('/ws/stats'), (ev) => {
    const s = JSON.parse(ev.data) as StatsSnapshot
    setStats(s)
    setHistory((h) => {
      if (h.length && h[h.length - 1].ts >= s.ts) return h
      const next = [...h, { ts: s.ts, cpu: s.cpu.percent, mem: s.memory.percent, rx: s.net.recv_bps, tx: s.net.sent_bps, dr: s.disk_io.read_bps, dw: s.disk_io.write_bps }]
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next
    })
    evaluate(s)
  })

  const value = useMemo(
    () => ({ stats, history, info, status, alerts, setAlerts, activeAlerts }),
    [stats, history, info, status, alerts, activeAlerts],
  )
  return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>
}

export function useStats() {
  const ctx = useContext(StatsContext)
  if (!ctx) throw new Error('useStats outside StatsProvider')
  return ctx
}
