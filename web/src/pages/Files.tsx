import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderArchive,
  FolderPlus,
  HardDrive,
  Home,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  Save,
  type LucideIcon,
} from 'lucide-react'
import { api, uploadFiles } from '@/lib/api'
import { usePersistentState } from '@/lib/hooks'
import type { FileItem, FileList, FileRoots } from '@/lib/types'
import { cn, downloadUrl, formatBytes, formatDate } from '@/lib/utils'
import { Button, Card, EmptyState, Input, Meter, Segmented, Skeleton, Spinner } from '@/components/ui/primitives'
import { Dialog, DropdownMenu, MenuItem, MenuSeparator, useConfirm } from '@/components/ui/overlay'

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
const VIDEO = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv']
const AUDIO = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus']
const ARCHIVE = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']
const CODE = ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'scss', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'ps1', 'bat', 'cmd', 'yml', 'yaml', 'toml', 'xml', 'sql', 'kt', 'swift', 'lua', 'ini', 'cfg', 'conf', 'env']
const TEXT = ['txt', 'md', 'log', 'csv', 'tsv', 'rtf', 'nfo', 'gitignore', ...CODE]

function iconFor(item: FileItem): { icon: LucideIcon; color: string } {
  if (item.is_dir) return { icon: Folder, color: 'text-accent' }
  const e = item.ext
  if (IMAGE.includes(e)) return { icon: FileImage, color: 'text-chart-2' }
  if (VIDEO.includes(e)) return { icon: FileVideo, color: 'text-danger' }
  if (AUDIO.includes(e)) return { icon: FileAudio, color: 'text-chart-3' }
  if (ARCHIVE.includes(e)) return { icon: FileArchive, color: 'text-warn' }
  if (CODE.includes(e)) return { icon: FileCode, color: 'text-ok' }
  if (TEXT.includes(e) || e === 'pdf') return { icon: FileText, color: 'text-fg-muted' }
  return { icon: File, color: 'text-fg-subtle' }
}

function previewKind(item: FileItem): 'image' | 'video' | 'audio' | 'pdf' | 'text' | null {
  const e = item.ext
  if (IMAGE.includes(e)) return 'image'
  if (VIDEO.includes(e)) return 'video'
  if (AUDIO.includes(e)) return 'audio'
  if (e === 'pdf') return 'pdf'
  if (TEXT.includes(e) || !e || (item.size ?? 0) < 256 * 1024) return 'text'
  return null
}

function splitPath(path: string, sep: string): { label: string; path: string }[] {
  if (!path) return []
  if (sep === '\\') {
    const parts = path.split('\\').filter(Boolean)
    const out: { label: string; path: string }[] = []
    let acc = ''
    parts.forEach((p, i) => {
      acc = i === 0 ? `${p}\\` : `${acc}${acc.endsWith('\\') ? '' : '\\'}${p}`
      out.push({ label: p, path: acc })
    })
    return out
  }
  const parts = path.split('/').filter(Boolean)
  const out = [{ label: '/', path: '/' }]
  let acc = ''
  for (const p of parts) {
    acc += `/${p}`
    out.push({ label: p, path: acc })
  }
  return out
}

type SortKey = 'name' | 'size' | 'modified'

function Preview({ item, onClose, onSaved }: { item: FileItem | null; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState<{ content: string; truncated: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const kind = item ? previewKind(item) : null

  useEffect(() => {
    setText(null)
    setError('')
    if (!item || kind !== 'text') return
    api
      .readText(item.path)
      .then((t) => {
        setText(t)
        setDraft(t.content)
      })
      .catch((e) => setError((e as Error).message))
  }, [item, kind])

  if (!item) return null
  const src = api.downloadHref(item.path, true)
  const dirty = text && draft !== text.content

  const save = async () => {
    setSaving(true)
    try {
      await api.writeText(item.path, draft)
      setText({ content: draft, truncated: false })
      toast.success('Saved')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      title={item.name}
      description={`${formatBytes(item.size)} · modified ${formatDate(item.modified)}`}
      className="max-w-4xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => downloadUrl(api.downloadHref(item.path), item.name)}>
            <Download /> Download
          </Button>
          {kind === 'text' && text && !text.truncated && (
            <Button variant="primary" onClick={save} disabled={!dirty} loading={saving}>
              <Save /> Save
            </Button>
          )}
        </>
      }
    >
      {kind === 'image' && <img src={src} alt={item.name} className="mx-auto max-h-[65vh] rounded-lg object-contain" />}
      {kind === 'video' && <video src={src} controls autoPlay className="mx-auto max-h-[65vh] w-full rounded-lg bg-black" />}
      {kind === 'audio' && <audio src={src} controls autoPlay className="w-full" />}
      {kind === 'pdf' && <iframe src={src} title={item.name} className="h-[65vh] w-full rounded-lg border border-border bg-white" />}
      {kind === 'text' &&
        (error ? (
          <EmptyState icon={<FileText />} title="Can't preview this file">
            {error}
          </EmptyState>
        ) : !text ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            {text.truncated && <p className="mb-2 text-xs text-warn">Showing the first 1 MB. Download the file to see all of it (editing is disabled).</p>}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={text.truncated}
              spellCheck={false}
              className="h-[60vh] w-full resize-none rounded-lg border border-border bg-bg-subtle p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault()
                  if (dirty) save()
                }
              }}
            />
          </>
        ))}
      {!kind && (
        <EmptyState icon={<File />} title="No preview for this file type">
          Download it to open it on this device.
        </EmptyState>
      )}
    </Dialog>
  )
}

export default function Files({ initialPath }: { initialPath?: string }) {
  const [roots, setRoots] = useState<FileRoots | null>(null)
  const [path, setPath] = usePersistentState('rpc.files.path', '')
  const [data, setData] = useState<FileList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = usePersistentState('rpc.files.hidden', false)
  const [view, setView] = usePersistentState<'list' | 'grid'>('rpc.files.view', 'list')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<FileItem | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ items: FileItem[]; truncated: boolean } | null>(null)
  const [searching, setSearching] = useState(false)
  const [editingPath, setEditingPath] = useState(false)
  const [pathDraft, setPathDraft] = useState('')
  const [nameDialog, setName