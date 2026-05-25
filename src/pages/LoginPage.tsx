import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CandlestickChart, ArrowRight, Mail, Lock, Sparkles } from 'lucide-react'
import { setJwt } from '@/contexts/AuthContext'

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
  const [success, setSuccess] = useState(false)

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
      setSuccess(true)
      setTimeout(() => navigate('/backtest', { replace: true }), 1200)
    } catch {
      setError('Network error — is the bot server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-black overflow-hidden">
      {/* ── Animated dot grid background ───────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 dot-grid" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.85)_70%,_rgba(0,0,0,1)_100%)]" />
        <div className="absolute -top-32 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-brand/10 blur-[120px]" />
      </div>

      {/* ── Mini navbar ─────────────────────────────────────────────── */}
      <header className="fixed top-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-x-6 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/20">
            <CandlestickChart className="h-4 w-4 text-brand" />
          </div>
          <span className="text-sm font-medium text-white/90">Garlic Trading</span>
        </div>
        <div className="hidden h-4 w-px bg-white/10 sm:block" />
        <div className="hidden items-center gap-1 text-xs text-white/50 sm:flex">
          <Sparkles className="h-3 w-3" />
          <span>Invite-only</span>
        </div>
      </header>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="space-y-6 text-center"
              >
                <h1 className="text-4xl font-bold tracking-tight text-white">You're in</h1>
                <p className="text-lg font-light text-white/60">Loading your dashboard…</p>
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-white to-white/70"
                >
                  <svg className="h-8 w-8 text-black" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </motion.div>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                {/* Heading */}
                <div className="mb-8 space-y-2 text-center">
                  <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
                    {tab === 'signin' ? 'Welcome back' : 'Create your account'}
                  </h1>
                  <p className="text-lg font-light text-white/50">
                    {tab === 'signin' ? 'Sign in to your dashboard' : 'Join Garlic Trading'}
                  </p>
                </div>

                {/* Tab switcher */}
                <div className="mb-6 flex rounded-full border border-white/10 bg-white/[0.03] p-1 backdrop-blur-sm">
                  {(['signin', 'register'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setTab(t); setError('') }}
                      className="relative flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors"
                    >
                      {tab === t && (
                        <motion.div
                          layoutId="active-tab"
                          className="absolute inset-0 rounded-full bg-white"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className={`relative ${tab === t ? 'text-black' : 'text-white/60 hover:text-white'}`}>
                        {t === 'signin' ? 'Sign In' : 'Register'}
                      </span>
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={tab}
                    initial={{ opacity: 0, x: tab === 'signin' ? -20 : 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: tab === 'signin' ? 20 : -20 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                  >
                    {/* Invite-only hint (Register only) */}
                    {tab === 'register' && (
                      <div className="mb-4 flex items-start gap-2 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-xs text-white/70 backdrop-blur-sm">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand" />
                        <span>
                          Registration is invite-only. Make sure your email has been whitelisted before signing up.
                        </span>
                      </div>
                    )}

                    <form onSubmit={submit} className="space-y-3">
                      {/* Email */}
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full rounded-full border border-white/10 bg-white/[0.03] py-3 pl-11 pr-4 text-sm text-white placeholder-white/30 backdrop-blur-sm transition-colors focus:border-white/30 focus:bg-white/[0.05] focus:outline-none"
                        />
                      </div>

                      {/* Password */}
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                        <input
                          type="password"
                          required
                          autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full rounded-full border border-white/10 bg-white/[0.03] py-3 pl-11 pr-4 text-sm text-white placeholder-white/30 backdrop-blur-sm transition-colors focus:border-white/30 focus:bg-white/[0.05] focus:outline-none"
                        />
                      </div>

                      {/* Confirm Password (Register only) */}
                      {tab === 'register' && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="relative"
                        >
                          <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                          <input
                            type="password"
                            required
                            autoComplete="new-password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="Confirm password"
                            className="w-full rounded-full border border-white/10 bg-white/[0.03] py-3 pl-11 pr-4 text-sm text-white placeholder-white/30 backdrop-blur-sm transition-colors focus:border-white/30 focus:bg-white/[0.05] focus:outline-none"
                          />
                        </motion.div>
                      )}

                      {/* Error */}
                      <AnimatePresence>
                        {error && (
                          <motion.p
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300"
                          >
                            {error}
                          </motion.p>
                        )}
                      </AnimatePresence>

                      {/* Submit */}
                      <motion.button
                        type="submit"
                        disabled={loading}
                        whileHover={{ scale: loading ? 1 : 1.01 }}
                        whileTap={{ scale: loading ? 1 : 0.99 }}
                        className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-white py-3 text-sm font-semibold text-black transition-opacity hover:bg-white/90 disabled:opacity-50"
                      >
                        <span>{loading ? 'Please wait…' : tab === 'signin' ? 'Sign In' : 'Create Account'}</span>
                        {!loading && (
                          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                        )}
                      </motion.button>
                    </form>
                  </motion.div>
                </AnimatePresence>

                {/* Footer */}
                <p className="mt-8 text-center text-xs text-white/30">
                  Garlic Trading · Hyperliquid perpetuals
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
