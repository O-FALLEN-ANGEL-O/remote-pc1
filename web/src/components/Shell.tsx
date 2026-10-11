import { useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronsUpDown,
  Command as CommandIcon,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
  TriangleAlert,
} from 'lucide-react'
import { navigate, usePersistentState, useTheme, type Route } from '@/lib/hooks'
import { NAV } from '@/lib/nav'
import { loadPcs, openPc, type SavedPc } from '@/lib/pcs'
import { useStats } from '@/lib/stats'
import { cn, formatDuration } from '@/lib/utils'
import { Logo } from './Logo'
import { Button, Kbd, StatusDot } from './ui/primitives'
import { Dialog, DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from './ui/overlay'

function usePcs() {
  const [pcs, setPcs] = useState<SavedPc[]>(loadPcs)
  useEffect(() => {
    const h = () => setPcs(loadPcs())
    window.addEventListener('rpc:pcs', h)
    return () => window.removeEventListener('rpc:pcs', h)
  }, [])
  return pcs
}

function PcSwitcher({ compact }: { compact?: boolean }) {
  const { info, status } = useStats()
  const pcs = usePcs()
  const tone = status === 'open' ? 'ok' : status === 'connecting' ? 'warn' : 'danger'
  return (
    <DropdownMenu
      align="start"
      trigger={
        <button
          className={cn(
            'flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-surface-2',
            compact && 'justify-center px-0',
          )}
          aria-label="Switch PC"
        >
          <Logo className="size-8 shrink-0" />
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{info?.hostname ?? 'Connecting…'}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                  <StatusDot tone={tone} />
                  {status === 'open' ? `${info?.os ?? ''} · live` : status === 'connecting' ? 'Connecting' : 'Offline'}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
            </>
          )}
        </button>
      }
    >
      <MenuLabel>Saved PCs</MenuLabel>
      {pcs.length === 0 && <div className="px-2.5 py-1.5 text-xs text-fg-subtle">None yet</div>}
      {pcs.map((pc) => {
        const current = pc.url === location.origin
        return (
          <MenuItem key={pc.id} icon={<Monitor />} onSelect={() => !current && openPc(pc)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{pc.name}</span>
              <span className="block truncate font-mono text-[10px] text-fg-subtle">{pc.url.replace(/^https?:\/\//, '')}</span>
            </span>
            {current && <Check className="!text-accent" />}
          </MenuItem>
        )
      })}
      <MenuSeparator />
      <MenuItem icon={<Plus />} onSelect={() => navigate('settings', 'pcs')}>
        Add or manage PCs
      </MenuItem>
    </DropdownMenu>
  )
}

function NavLink({ route, active, collapsed, onClick }: { route: (typeof NAV)[number]; active: boolean; collapsed?: boolean; onClick?: () => void }) {
  const Icon = route.icon
  return (
    <a
      href={`#/${route.route}`}
      onClick={onClick}
      title={collapsed ? route.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
        active && 'bg-surface-2 text-fg',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-accent" />}
      <Icon className={cn('size-[18px] shrink-0', active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted')} />
      {!collapsed && <span className="truncate">{route.label}</span>}
    </a>
  )
}

function Sidebar({ route, collapsed, setCollapsed, onLogout }: { route: Route; collapsed: boolean; setCollapsed: (v: boolean) => void; onLogout: () => void }) {
  const groups = ['Monitor', 'Control', 'Agent'] as const
  const { stats } = useStats()
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-bg-subtle/60 p-3 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[68px]' : 'w-[248px]',
      )}
    >
      <PcSwitcher compact={collapsed} />
      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto scrollbar-thin" aria-label="Main">
        {groups.map((g) => (
          <div key={g}>
            {!collapsed && <div className="mb-1.5 px-2.5 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{g}</div>}
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavLink key={n.route} route={n} active={route === n.route} collapsed={collapsed} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-border pt-3">
        {!collapsed && stats && (
          <div className="mb-2 px-2.5 text-[11px] text-fg-subtle">
            Up {formatDuration(stats.uptime)} · {stats.process_count} processes
          </div>
        )}
        <div className={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center')}>
          <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <Button variant="ghost" size={collapsed ? 'icon-sm' : 'sm'} onClick={onLogout} className={collapsed ? '' : 'ml-auto'} aria-label="Sign out">
            <LogOut />
            {!collapsed && 'Sign out'}
          </Button>
        </div>
      </div>
    </aside>
  )
}

function ThemeToggle() {
  const { resolved: theme, setTheme } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}

function Topbar({ route, onPalette }: { route: Route; onPalette: () => void }) {
  const { activeAlerts, status } = useStats()
  const current = NAV.find((n) => n.route === route)
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/80 px-3 backdrop-blur-xl sm:px-5">
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <PcSwitcher />
      </div>
      <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
        <span className="font-medium">{current?.label}</span>
        <span className="truncate text-fg-subtle">{current?.hint}</span>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {status !== 'open' && (
          <span className="hidden items-center gap-1.5 rounded-md bg-warn/15 px-2 py-1 text-xs text-warn sm:inline-flex">
            {status === 'unauthorized' ? 'Session expired' : 'Reconnecting…'}
          </span>
        )}
        {activeAlerts.length > 0 && (
          <a
            href="#/overview"
            className="inline-flex items-center gap-1.5 rounded-md bg-danger/12 px-2 py-1 text-xs font-medium text-danger"
            title="Active alerts"
          >
            <TriangleAlert className="size-3.5" />
            {activeAlerts.length} alert{activeAlerts.length > 1 ? 's' : ''}
          </a>
        )}
        <button
          onClick={onPalette}
          className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-bg-subtle px-3 text-[13px] text-fg-subtle transition-colors hover:text-fg sm:flex"
        >
          <Search className="size-4" />
          <span className="mr-6">Search or run…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <Button variant="ghost" size="icon" className="sm:hidden" onClick={onPalette} aria-label="Open command palette">
          <CommandIcon />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  )
}

function MobileNav({ route, onLogout }: { route: Route; onLogout: () => void }) {
  const [more, setMore] = useState(false)
  const primary = NAV.filter((n) => n.mobile)
  const secondary = NAV.filter((n) => !n.mobile)
  const inMore = secondary.some((n) => n.route === route)
  return (
    <>
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/90 backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {primary.map((n) => {
            const Icon = n.icon
            const active = route === n.route
            return (
              <a
                key={n.route}
                href={`#/${n.route}`}
                aria-current={active ? 'page' : undefined}
                className={cn('flex flex-col items-center gap-1 py-2 text-[10px] font-medium text-fg-subtle', active && 'text-accent')}
              >
                <Icon className="size-5" />
                {n.label.replace('Remote screen', 'Screen')}
              </a>
            )
          })}
          <button
            onClick={() => setMore(true)}
            className={cn('flex flex-col items-center gap-1 py-2 text-[10px] font-medium text-fg-subtle', inMore && 'text-accent')}
          >
            <MoreHorizontal className="size-5" />
            More
          </button>
        </div>
      </nav>
      <Dialog open={more} onOpenChange={setMore} title="More">
        <div className="grid grid-cols-2 gap-2">
          {secondary.map((n) => {
            const Icon = n.icon
            return (
              <a
                key={n.route}
                href={`#/${n.route}`}
                onClick={() => setMore(false)}
                className={cn('flex flex-col gap-2 rounded-xl border border-border p-3 hover:bg-surface-2', route === n.route && 'border-accent')}
              >
                <Icon className="size-5 text-accent" />
                <span className="text-sm font-medium">{n.label}</span>
                <span className="text-xs text-fg-subtle">{n.hint}</span>
              </a>
            )
          })}
          <button onClick={onLogout} className="flex flex-col gap-2 rounded-xl border border-border p-3 text-left hover:bg-surface-2">
            <LogOut className="size-5 text-danger" />
            <span className="text-sm font-medium">Sign out</span>
            <span className="text-xs text-fg-subtle">End this session</span>
          </button>
        </div>
      </Dialog>
    </>
  )
}

export function Shell({
  route,
  children,
  onLogout,
  onPalette,
}: {
  route: Route
  children: ReactNode
  onLogout: () => void
  onPalette: () => void
}) {
  const [collapsed, setCollapsed] = usePersistentState('rpc.sidebar.collapsed', false)
  const fullBleed = route === 'screen' || route === 'terminal'
  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar route={route} collapsed={collapsed} setCollapsed={setCollapsed} onLogout={onLogout} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar route={route} onPalette={onPalette} />
        <main
          id="main"
          className={cn(
            'mx-auto w-full flex-1 pb-24 lg:pb-8',
            fullBleed ? 'flex flex-col px-0 pt-0 sm:px-4 sm:pt-4' : 'max-w-[1400px] px-4 pt-5 sm:px-6 sm:pt-6',
          )}
        >
          {children}
        </main>
      </div>
      <MobileNav route={route} onLogout={onLogout} />
    </div>
  )
}
