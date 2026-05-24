import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { setJwt } from '@/contexts/AuthContext'
import { CandlestickChart } from 'lucide-react'

type Tab = 'signin' | 'register'

interface AuthResponse {
  token?: string
  error?: string
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (tab === 'register' && password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    try {
      const endpoint = tab === 'signin' ? '/auth/login' : '/auth/register'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = (await res.json()) as AuthResponse
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        return
      }
      if (!data.token) { setError('No token received'); return }
      setJwt(data.token)
      navigate('/backtest', { replace: true })
    } catch {
      setError('Network error — is the bot server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4"
         style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, hsl(var(--brand)/0.06) 0%, transparent 70%)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
            <CandlestickChart className="h-7 w-7 text-brand" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-text">Garlic Trading</h1>
            <p className="text-sm text-dim">Algorithmic trading dashboard</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-panel p-6 shadow-xl">
          {/* Tabs */}
          <div className="mb-6 flex rounded-xl bg-panel-2 p-1">
            {(['signin', 'register'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setError('') }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-150 ${
                  tab === t
                    ? 'bg-panel text-text shadow-sm'
                    : 'text-dim hover:text-text'
                }`}
              >
                {t === 'signin' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-dim">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder-dim/50
                           focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-dim">Password</label>
              <input
                type="password"
                required
                autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder-dim/50
                           focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>

            {tab === 'register' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-dim">Confirm Password</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm text-text placeholder-dim/50
                             focus:border-brand/60 focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white
                         transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Please wait…' : tab === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-dim/60">
          Garlic Trading · Hyperliquid perpetuals
        </p>
      </div>
    </div>
  )
}
