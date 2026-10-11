import { useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BatteryCharging,
  BatteryMedium,
  Camera,
  Cpu,
  HardDrive,
  ListTree,
  MemoryStick,
  MonitorPlay,
  Network,
  Thermometer,
  TriangleAlert,
  History,
  ArrowRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAsync, useInterval } from '@/lib/hooks'
import { useStats } from '@/lib/stats'
import type { StatsSnapshot } from '@/lib/types'
import { cn, downloadUrl, formatBytes, formatDuration, formatRate, level, levelColor, levelLabel, timeAgo } from '@/lib/utils'
import { AreaChart, Legend, Sparkline } from '@/components/ui/charts'
import { Badge, Button, Card, CardHeader, Meter, Skeleton } from '@/components/ui/primitives'

function primaryDisk(s: StatsSnapshot) {
  return s.disks.find((d) => d.mount === '/' || /^C:\\?$/i.test(d.mount)) ?? [...s.disks].sort((a, b) => b.total - a.total)[0]
}

function KpiCard({
  icon,
  label,
  value,
  unit,
  pct,
  sub,
  spark,
  sparkMax = 100,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  pct: number | null
  sub: React.ReactNode
  spark: number[]
  sparkMax?: number
  color?: string
}) {
  const lv = level(pct)
  const c = color ?? levelColor[lv]
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
        <span className="flex items-center gap-2 text-[13px] font-medium text-fg-muted [&_svg]:size-4">
          {icon}
          {label}
        </span>
        {pct != null && <Badge tone={lv === 'ok' ? 'neutral' : lv === 'warn' ? 'warn' : 'danger'}>{levelLabel[lv]}</Badge>}
      </div>
      <div className="flex items-baseline gap-1 px-4 pt-2 sm:px-5">
        <span className="font-mono text-[28px] leading-none font-semibold tracking-tight tabular sm:text-[32px]">{value}</span>
        {unit && <span className="text-sm text-fg-subtle">{unit}</span>}
      </div>
      <div className="mt-1.5 truncate px-4 text-xs text-fg-subtle sm:px-5">{sub}</div>
      <Sparkline values={spark} max={sparkMax} color={c} height={44} className="mt-auto pt-3" />
    </Card>
  )
}

function CoreGrid({ cores }: { cores: number[] }) {
  const cols = cores.length > 16 ? 'grid-cols-8' : cores.length > 8 ? 'grid-cols-6 sm:grid-cols-8' : 'grid-cols-4'
  return (
    <div className={cn('grid gap-1.5', cols)}>
      {cores.map((v, i) => {
        const lv = level(v, 70, 90)
        return (
          <div
            key={i}
            title={`Core ${i}: ${v.toFixed(0)}%`}
            className="relative flex h-12 flex-col justify-end overflow-hidden rounded-md border border-border bg-bg-subtle"
          >
            <div
              className="absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-out"
              style={{ height: `${Math.max(3, v)}%`, background: `color-mix(in oklch, ${levelColor[lv]} 55%, transparent)` }}
            />
            <span className="relative px-1 pb-0.5 font-mono text-[10px] text-fg tabular">{v.toFixed(0)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Overview() {
  const { stats, history, info, activeAlerts, alerts } = useStats()
  const procs = useAsync(() => api.processes(), [])
  const audit = useAsync(() => api.audit(6), [])
  useInterval(() => procs.reload(true), 4000)
  useInterval(() => audit.reload(true), 10000)

  const ts = history.map((h) => h.ts)
  const cpuHist = history.map((h) => h.cpu)
  const memHist = history.map((h) => h.mem)
  const rxHist = history.map((h) => h.rx)
  const txHist = history.map((h) => h.tx)
  const netMax = Math.max(1024, ...rxHist, ...txHist)

  const topProcs = useMemo(
    () => [...(procs.data ?? [])].filter((p) => p.name !== 'System Idle Process' && p.pid !== 0).sort((a, b) => b.cpu - a.cpu || b.rss - a.rss).slice(0, 6),
    [procs.data],
  )

  if (!stats) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-[14px]" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-[14px]" />
      </div>
    )
  }

  const disk = primaryDisk(stats)
  const alertText = activeAlerts.map((a) =>
    a === 'cpu' ? `CPU above ${alerts?.cpu}%` : a === 'memory' ? `Memory above ${alerts?.memory}%` : a === 'battery' ? `Battery below ${alerts?.battery}%` : `Disk ${a.slice(5)} above ${alerts?.disk}%`,
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{info?.hostname ?? 'This PC'}</h1>
          <p className="mt-1 truncate text-sm text-fg-muted">
            {info ? `${info.os} ${info.os_release} · ${info.cpu_model} · ` : ''}up {formatDuration(stats.uptime)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadUrl(api.screenshotHref(1), `screenshot-${Date.now()}.png`)}>
            <Camera /> Screenshot
          </Button>
          <Button size="sm" variant="primary" onClick={() => (location.hash = '/screen')}>
            <MonitorPlay /> Open screen
          </Button>
        </div>
      </div>

      {alertText.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-danger">Needs attention</p>
            <p className="text-fg-muted">{alertText.join(' · ')}</p>
          </div>
        </div>
      )}

      {/* KPI strip: what you glance at first */}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<Cpu />}
          label="CPU"
          value={stats.cpu.percent.toFixed(0)}
          unit="%"
          pct={stats.cpu.percent}
          sub={`${stats.cpu.per_core.length} threads${stats.cpu.freq_mhz ? ` · ${(stats.cpu.freq_mhz / 1000).toFixed(2)} GHz` : ''}`}
          spark={cpuHist}
        />
        <KpiCard
          icon={<MemoryStick />}
          label="Memory"
          value={stats.memory.percent.toFixed(0)}
          unit="%"
          pct={stats.memory.percent}
          sub={`${formatBytes(stats.memory.used)} of ${formatBytes(stats.memory.total)}`}
          spark={memHist}
        />
        <KpiCard
          icon={<HardDrive />}
          label={`Disk ${disk?.mount ?? ''}`}
          value={disk ? disk.percent.toFixed(0) : '—'}
          unit="%"
          pct={disk?.percent ?? null}
          sub={disk ? `${formatBytes(disk.free)} free of ${formatBytes(disk.total)}` : 'No disks'}
          spark={history.map((h) => h.dr + h.dw)}
          sparkMax={Math.max(1024, ...history.map((h) => h.dr + h.dw))}
        />
        <KpiCard
          icon={<Network />}
          label="Network"
          value={formatRate(stats.net.recv_bps).split(' ')[0]}
          unit={`${formatRate(stats.net.recv_bps).split(' ')[1] ?? ''} ↓`}
          pct={null}
          color="var(--chart-2)"
          sub={
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-3" /> {formatRate(stats.net.sent_bps)} up
            </span>
          }
          spark={rxHist}
          sparkMax={netMax}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="CPU & memory"
            subtitle="Last 2 minutes"
            action={
              <Legend
                items={[
                  { label: 'CPU', color: 'var(--accent)', value: `${stats.cpu.percent.toFixed(0)}%` },
                  { label: 'Memory', color: 'var(--chart-2)', value: `${stats.memory.percent.toFixed(0)}%` },
                ]}
              />
            }
          />
          <div className="px-2 pb-3 sm:px-3">
            <AreaChart
              ariaLabel={`CPU ${stats.cpu.percent.toFixed(0)} percent, memory ${stats.memory.percent.toFixed(0)} percent`}
              timestamps={ts}
              max={100}
              height={220}
              series={[
                { key: 'cpu', label: 'CPU', color: 'var(--accent)', values: cpuHist },
                { key: 'mem', label: 'Memory', color: 'var(--chart-2)', values: memHist },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Per-core load"
            subtitle={stats.cpu.load ? `Load average ${stats.cpu.load.join(' · ')}` : `${stats.cpu.per_core.length} logical cores`}
          />
          <div className="px-4 pb-4 sm:px-5">
            <CoreGrid cores={stats.cpu.per_core} />
          </div>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Network throughput"
            subtitle={`Since boot: ${formatBytes(stats.net.total_recv)} down · ${formatBytes(stats.net.total_sent)} up`}
            action={
              <Legend
                items={[
                  { label: <ArrowDown className="size-3" />, color: 'var(--chart-2)', value: formatRate(stats.net.recv_bps) },
                  { label: <ArrowUp className="size-3" />, color: 'var(--chart-3)', value: formatRate(stats.net.sent_bps) },
                ]}
              />
            }
          />
          <div className="px-2 pb-3 sm:px-3">
            <AreaChart
              ariaLabel={`Download ${formatRate(stats.net.recv_bps)}, upload ${formatRate(stats.net.sent_bps)}`}
              timestamps={ts}
              height={180}
              format={(v) => formatBytes(v, 0)}
              series={[
                { key: 'rx', label: 'Download', color: 'var(--chart-2)', values: rxHist },
                { key: 'tx', label: 'Upload', color: 'var(--chart-3)', values: txHist },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Storage" icon={<HardDrive />} subtitle={`Read ${formatRate(stats.disk_io.read_bps)} · Write ${formatRate(stats.disk_io.write_bps)}`} />
          <ul className="space-y-3.5 px-4 pb-4 sm:px-5">
            {stats.disks.map((d) => {
              const lv = level(d.percent, 80, alerts?.disk ?? 95)
              return (
                <li key={d.mount}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                    <a href={`#/files/${encodeURIComponent(d.mount)}`} className="truncate font-medium hover:text-accent">
                      {d.mount}
                    </a>
                    <span className="shrink-0 font-mono text-xs text-fg-muted tabular">
                      {formatBytes(d.used)} / {formatBytes(d.total)}
                    </span>
                  </div>
                  <Meter value={d.percent} color={levelColor[lv]} label={`${d.mount} ${d.percent}% used`} />
                </li>
              )
            })}
          </ul>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Top processes"
            icon={<ListTree />}
            action={
              <Button size="sm" variant="ghost" onClick={() => (location.hash = '/processes')}>
                All <ArrowRight />
              </Button>
            }
          />
          <div className="overflow-x-auto px-2 pb-2">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 text-right font-medium">CPU</th>
                  <th className="px-3 py-2 text-right font-medium">Memory</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">PID</th>
                </tr>
              </thead>
              <tbody>
                {topProcs.map((p) => (
                  <tr key={p.pid} className="border-t border-border">
                    <td className="max-w-[220px] truncate px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular">{p.cpu.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-mono tabular">{formatBytes(p.rss)}</td>
                    <td className="hidden px-3 py-2 text-right font-mono text-fg-subtle tabular sm:table-cell">{p.pid}</td>
                  </tr>
                ))}
                {!procs.data &&
                  [0, 1, 2, 3].map((i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-3 py-2">
                        <Skeleton className="h-4" />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid gap-3">
          <Card>
            <CardHeader title="Power & sensors" icon={<Thermometer />} />
            <div className="space-y-3 px-4 pb-4 text-[13px] sm:px-5">
              {stats.battery ? (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {stats.battery.plugged ? <BatteryCharging className="size-4 text-ok" /> : <BatteryMedium className="size-4 text-fg-subtle" />}
                      Battery {stats.battery.plugged ? '· charging' : stats.battery.secs_left ? `· ${formatDuration(stats.battery.secs_left)} left` : ''}
                    </span>
                    <span className="font-mono tabular">{stats.battery.percent.toFixed(0)}%</span>
                  </div>
                  <Meter value={stats.battery.percent} color={stats.battery.percent < 20 ? 'var(--danger)' : 'var(--ok)'} label="Battery" />
                </div>
              ) : (
                <p className="text-fg-subtle">No battery (desktop power).</p>
              )}
              {stats.temps?.length ? (
                <ul className="grid grid-cols-2 gap-2">
                  {stats.temps.slice(0, 6).map((t, i) => (
                    <li key={i} className="rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5">
                      <div className="truncate text-[11px] text-fg-subtle">{t.label}</div>
                      <div className={cn('font-mono tabular', t.high && t.current >= t.high ? 'text-danger' : '')}>{t.current.toFixed(0)}°C</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-subtle">Temperature sensors aren't exposed on this OS.</p>
              )}
              <div className="flex justify-between border-t border-border pt-3 text-fg-muted">
                <span>Swap</span>
                <span className="font-mono tabular">
                  {formatBytes(stats.memory.swap_used)} / {formatBytes(stats.memory.swap_total)}
                </span>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Recent activity"
              icon={<History />}
              action={
                <Button size="sm" variant="ghost" onClick={() => (location.hash = '/activity')}>
                  All <ArrowRight />
                </Button>
              }
            />
            <ul className="space-y-2 px-4 pb-4 text-[13px] sm:px-5">
              {(audit.data ?? []).slice(0, 5).map((e, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={cn('size-1.5 shrink-0 rounded-full', e.ok ? 'bg-accent' : 'bg-danger')} />
                  <span className="truncate font-mono text-xs">{e.action}</span>
                  <span className="ml-auto shrink-0 text-xs text-fg-subtle">{timeAgo(e.ts)}</span>
                </li>
              ))}
              {audit.data?.length === 0 && <li className="text-fg-subtle">Nothing yet.</li>}
            </ul>
          </Card>
        </div>
      </section>
    </div>
  )
}
