export interface Disk {
  mount: string
  device: string
  fstype: string
  total: number
  used: number
  free: number
  percent: number
}

export interface StatsSnapshot {
  ts: number
  cpu: { percent: number; per_core: number[]; freq_mhz: number | null; load: number[] | null }
  memory: {
    total: number
    used: number
    available: number
    percent: number
    swap_total: number
    swap_used: number
    swap_percent: number
  }
  disks: Disk[]
  disk_io: { read_bps: number; write_bps: number }
  net: { sent_bps: number; recv_bps: number; total_sent: number; total_recv: number }
  battery: { percent: number; plugged: boolean; secs_left: number | null } | null
  temps: { label: string; chip: string; current: number; high: number | null }[] | null
  uptime: number
  process_count: number
}

export interface HistoryPoint {
  ts: number
  cpu: number
  mem: number
  rx: number
  tx: number
  dr: number
  dw: number
}

export interface NetInterface {
  name: string
  up: boolean
  speed: number
  mtu: number
  ipv4: string[]
  ipv6: string[]
  mac: string | null
}

export interface SystemInfo {
  hostname: string
  os: string
  os_release: string
  os_version: string
  platform: string
  arch: string
  python: string
  cpu_model: string
  cores_physical: number | null
  cores_logical: number
  cpu_max_mhz: number | null
  memory_total: number
  swap_total: number
  boot_time: number
  users: string[]
  interfaces: NetInterface[]
  disks: { mount: string; device: string; fstype: string; total: number }[]
  agent_pid: number
}

export interface Proc {
  pid: number
  name: string
  user: string | null
  cpu: number
  rss: number
  mem_percent: number
  status: string | null
  started: number | null
  threads: number | null
  exe: string | null
}

export interface Connections {
  error: string | null
  items: { proto: string; laddr: string; raddr: string; status: string; pid: number | null; process: string | null }[]
}

export interface FileItem {
  name: string
  path: string
  is_dir: boolean
  size: number | null
  modified: number | null
  hidden: boolean
  ext: string
  symlink: boolean
}

export interface FileList {
  path: string
  parent: string | null
  items: FileItem[]
}

export interface FileRoots {
  items: { name: string; path: string; kind: 'drive' | 'place'; total: number | null; free: number | null }[]
  home: string
  sep: string
}

export interface Monitor {
  index: number
  name: string
  left: number
  top: number
  width: number
  height: number
  primary?: boolean
}

export interface Alerts {
  enabled: boolean
  cpu: number
  memory: number
  disk: number
  battery: number
}

export interface Settings {
  alerts: Alerts
  stats_interval: number
  session_hours: number
  port: number
  version: string
  shells: { id: string; name: string }[]
}

export interface AuditEntry {
  ts: number
  action: string
  detail: string
  ip: string
  ok: boolean
}
