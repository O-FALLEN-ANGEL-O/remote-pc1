import {
  FolderOpen,
  Gauge,
  History,
  ListTree,
  MonitorPlay,
  Server,
  Settings,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import type { Route } from './hooks'

export interface NavItem {
  route: Route
  label: string
  icon: LucideIcon
  hint: string
  group: 'Monitor' | 'Control' | 'Agent'
  mobile?: boolean
}

export const NAV: NavItem[] = [
  { route: 'overview', label: 'Overview', icon: Gauge, hint: 'Live CPU, memory, disk and network', group: 'Monitor', mobile: true },
  { route: 'processes', label: 'Processes', icon: ListTree, hint: 'See and end running programs', group: 'Monitor' },
  { route: 'system', label: 'System', icon: Server, hint: 'Hardware, network interfaces, connections', group: 'Monitor' },
  { route: 'screen', label: 'Remote screen', icon: MonitorPlay, hint: 'View and control the desktop', group: 'Control', mobile: true },
  { route: 'terminal', label: 'Terminal', icon: SquareTerminal, hint: 'Interactive shell', group: 'Control', mobile: true },
  { route: 'files', label: 'Files', icon: FolderOpen, hint: 'Browse, upload, download, edit', group: 'Control', mobile: true },
  { route: 'controls', label: 'Controls', icon: SlidersHorizontal, hint: 'Power, volume, media, clipboard', group: 'Control' },
  { route: 'activity', label: 'Activity', icon: History, hint: 'Audit log of actions', group: 'Agent' },
  { route: 'settings', label: 'Settings', icon: Settings, hint: 'Alerts, token, saved PCs, theme', group: 'Agent' },
]
