import { storage, store } from './utils'

/**
 * Saved PCs. Every agent serves its own copy of this UI, so switching PC means
 * opening that agent's address. Tokens are only stored if the user opts in.
 */
export interface SavedPc {
  id: string
  name: string
  url: string
  token?: string
}

const KEY = 'rpc.pcs'

export function loadPcs(): SavedPc[] {
  return storage<SavedPc[]>(KEY, [])
}

export function savePcs(pcs: SavedPc[]) {
  store(KEY, pcs)
  window.dispatchEvent(new Event('rpc:pcs'))
}

export function normalizeUrl(raw: string): string {
  let url = raw.trim()
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  const u = new URL(url)
  if (!u.port && u.protocol === 'http:' && !raw.includes(':80')) u.port = '8000'
  return u.origin
}

export function rememberCurrentPc(hostname: string) {
  const pcs = loadPcs()
  const origin = location.origin
  const existing = pcs.find((p) => p.url === origin)
  if (existing) {
    if (existing.name !== hostname && existing.name === existing.url) {
      existing.name = hostname
      savePcs(pcs)
    }
    return
  }
  savePcs([...pcs, { id: crypto.randomUUID?.() ?? String(Date.now()), name: hostname, url: origin }])
}

export function openPc(pc: SavedPc) {
  const target = pc.token ? `${pc.url}/#token=${encodeURIComponent(pc.token)}` : `${pc.url}/`
  location.href = target
}
