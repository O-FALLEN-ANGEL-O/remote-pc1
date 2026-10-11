import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { api, UNAUTHORIZED_EVENT } from '@/lib/api'
import { useRoute, useTheme } from '@/lib/hooks'
import { rememberCurrentPc } from '@/lib/pcs'
import { StatsProvider } from '@/lib/stats'
import { Shell } from '@/components/Shell'
import { CommandPalette } from '@/components/CommandPalette'
import { Spinner } from '@/components/ui/primitives'
import { Login } from '@/pages/Login'
import { Overview } from '@/pages/Overview'

const Screen = lazy(() => import('@/pages/Screen'))
const Terminal = lazy(() => import('@/pages/Terminal'))
const Files = lazy(() => import('@/pages/Files'))
const Processes = lazy(() => import('@/pages/Processes'))
const System = lazy(() => import('@/pages/System'))
const Controls = lazy(() => import('@/pages/Controls'))
const Activity = lazy(() => import('@/pages/Activity'))
const SettingsPage = lazy(() => import('@/pages/Settings'))

type AuthState = 'checking' | 'in' | 'out'

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking')
  const [loginError, setLoginError] = useState<string>()
  const [palette, setPalette] = useState(false)
  const { route, param } = useRoute()
  const { resolved } = useTheme()

  const check = useCallback(async () => {
    // A link like http://pc:8000/#token=... signs in straight away, then the token is
    // removed from the address bar so it doesn't linger in history.
    const m = location.hash.match(/token=([^&]+)/)
    if (m) {
      history.replaceState(null, '', location.pathname + '#/overview')
      try {
        await api.login(decodeURIComponent(m[1]))
      } catch (e) {
        setLoginError((e as Error).message)
      }
    }
    try {
      const s = await api.status()
      setAuth(s.authenticated ? 'in' : 'out')
      if (s.authenticated && s.hostname) rememberCurrentPc(s.hostname)
    } catch {
      setAuth('out')
    }
  }, [])

  useEffect(() => {
    check()
    const onUnauthorized = () => setAuth('out')
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [check])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && auth === 'in') {
        // The remote screen captures keys when control is on; it handles its own shortcut.
        if (document.activeElement?.closest('[data-capture-keys]')) return
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [auth])

  const logout = async () => {
    await api.logout().catch(() => {})
    setAuth('out')
  }

  const toaster = (
    <Toaster
      theme={resolved}
      position="top-right"
      closeButton
      toastOptions={{ className: '!rounded-xl !border-border !bg-surface !text-fg' }}
    />
  )

  if (auth === 'checking') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (auth === 'out') {
    return (
      <>
        <Login onSuccess={() => check()} initialError={loginError} />
        {toaster}
      </>
    )
  }

  const page = (() => {
    switch (route) {
      case 'screen':
        return <Screen />
      case 'terminal':
        return <Terminal initialCommand={param} />
      case 'files':
        return <Files initialPath={param} />
      case 'processes':
        return <Processes />
      case 'system':
        return <System />
      case 'controls':
        return <Controls />
      case 'activity':
        return <Activity />
      case 'settings':
        return <SettingsPage section={param} />
      default:
        return <Overview />
    }
  })()

  return (
    <StatsProvider>
      <Shell route={route} onLogout={logout} onPalette={() => setPalette(true)}>
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center py-24">
              <Spinner className="size-6" />
            </div>
          }
        >
          <div key={route} className="flex flex-1 flex-col animate-fade-up">
            {page}
          </div>
        </Suspense>
      </Shell>
      <CommandPalette open={palette} onOpenChange={setPalette} onLogout={logout} />
      {toaster}
    </StatsProvider>
  )
}
