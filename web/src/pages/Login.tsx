import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Input } from '@/components/ui/primitives'
import { Logo } from '@/components/Logo'

export function Login({ onSuccess, initialError }: { onSuccess: () => void; initialError?: string }) {
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError ?? '')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.login(token.trim())
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(600px 300px at 50% -10%, var(--accent-soft), transparent 70%), radial-gradient(400px 240px at 85% 110%, color-mix(in oklch, var(--chart-2) 14%, transparent), transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
        style={{
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="relative w-full max-w-[380px] animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-4 size-12" />
          <h1 className="text-2xl font-semibold tracking-tight">Remote PC</h1>
          <p className="mt-1.5 text-sm text-fg-muted">Sign in with the access token printed by the agent.</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div className="space-y-1.5">
            <label htmlFor="token" className="text-[13px] font-medium">
              Access token
            </label>
            <div className="relative">
              <Input
                id="token"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token"
                icon={<KeyRound />}
                className="h-11 pr-10 font-mono text-[13px]"
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-fg-subtle hover:text-fg"
                aria-label={show ? 'Hide token' : 'Show token'}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {error ? (
              <p id="login-error" role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!token.trim()}>
            Connect <ArrowRight />
          </Button>
        </form>
        <div className="mt-5 flex items-start gap-2.5 px-1 text-xs leading-relaxed text-fg-subtle">
          <ShieldCheck className="mt-px size-4 shrink-0 text-ok" />
          <p>
            Find the token in the agent's console window, or run <code className="font-mono text-fg-muted">python agent.py --show-token</code> on the PC.
          </p>
        </div>
      </div>
    </div>
  )
}
