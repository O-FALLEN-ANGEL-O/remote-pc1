import type {
  AuditEntry,
  Connections,
  FileList,
  FileRoots,
  Monitor,
  Proc,
  Settings,
  StatsSnapshot,
  SystemInfo,
  HistoryPoint,
  FileItem,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const UNAUTHORIZED_EVENT = 'rpc:unauthorized'

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`/api${path}`, { method, body: payload, headers, credentials: 'same-origin', ...init })
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, message)
  }
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>
}

const get = <T>(p: string) => request<T>('GET', p)
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {})
const put = <T>(p: string, b?: unknown) => request<T>('PUT', p, b)
const q = (params: Record<string, string | number | boolean>) => '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))

export const api = {
  status: () => get<{ authenticated: boolean; hostname?: string; os?: string; version?: string }>('/auth/status'),
  login: (token: string) => post<{ ok: true }>('/auth/login', { token }),
  logout: () => post('/auth/logout'),
  rotateToken: () => post<{ token: string }>('/auth/rotate'),

  info: () => get<SystemInfo>('/system/info'),
  stats: () => get<StatsSnapshot>('/system/stats'),
  history: () => get<HistoryPoint[]>('/system/history'),
  processes: () => get<Proc[]>('/processes'),
  kill: (pid: number, force = false) => post<{ ok: boolean; running: boolean }>(`/processes/${pid}/kill`, { force }),
  connections: () => get<Connections>('/network/connections'),

  roots: () => get<FileRoots>('/files/roots'),
  list: (path: string) => get<FileList>(`/files/list${q({ path })}`),
  search: (path: string, query: string) => get<{ items: FileItem[]; truncated: boolean }>(`/files/search${q({ path, q: query })}`),
  readText: (path: string) => get<{ content: string; truncated: boolean; size: number }>(`/files/text${q({ path })}`),
  writeText: (path: string, content: string) => put('/files/text', { path, content }),
  mkdir: (path: string, name: string) => post<{ path: string }>('/files/mkdir', { path, name }),
  rename: (path: string, name: string) => post<{ path: string }>('/files/rename', { path, name }),
  remove: (paths: string[], permanent = false) =>
    post<{ results: { path: string; ok: boolean; error?: string }[] }>('/files/delete', { paths, permanent }),
  downloadHref: (path: string, inline = false) => `/api/files/download${q({ path, inline })}`,
  zipHref: (path: string) => `/api/files/zip${q({ path })}`,

  monitors: () => get<Monitor[]>('/screen/monitors'),
  screenshotHref: (monitor: number) => `/api/screen/screenshot${q({ monitor, t: Date.now() })}`,

  power: (action: string) => post<{ ok: boolean; command: string[]; dry_run?: boolean }>(`/power/${action}`),
  clipboard: () => get<{ text: string }>('/clipboard'),
  setClipboard: (text: string) => post('/clipboard', { text }),
  media: (action: string) => post(`/media/${action}`),
  volume: () => get<{ supported: boolean; level: number | null; muted: boolean | null; error?: string }>('/volume'),
  setVolume: (body: { level?: number; muted?: boolean }) =>
    post<{ supported: boolean; level: number; muted: boolean }>('/volume', body),

  settings: () => get<Settings>('/settings'),
  saveSettings: (body: Partial<Pick<Settings, 'alerts' | 'stats_interval' | 'session_hours'>>) => put<Settings>('/settings', body),
  audit: (limit = 200) => get<AuditEntry[]>(`/audit${q({ limit })}`),
}

/** Upload with progress (fetch has no upload progress, so XHR). */
export function uploadFiles(dest: string, files: File[], onProgress: (pct: number) => void): Promise<{ saved: string[] }> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('path', dest)
    files.forEach((f) => form.append('files', f, f.name))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files/upload')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
      else {
        let msg = `Upload failed (${xhr.status})`
        try {
          msg = JSON.parse(xhr.responseText).detail ?? msg
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, msg))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))
    xhr.send(form)
  })
}

export function wsUrl(path: string, params: Record<string, string | number> = {}) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const qs = Object.keys(params).length ? q(params as Record<string, string | number>) : ''
  return `${proto}//${location.host}/api${path}${qs}`
}
