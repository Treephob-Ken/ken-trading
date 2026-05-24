import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

// Must match localStorage key used by the vanilla dashboard.
const JWT_KEY = 'auth_jwt'

export interface AuthUser {
  sub: string    // userId
  email: string
  isAdmin: boolean
}

interface AuthContextValue {
  user: AuthUser
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

// ─── JWT helpers (exported so other modules can build authenticated requests) ──

export function getJwt(): string {
  return localStorage.getItem(JWT_KEY) ?? ''
}

export function setJwt(token: string): void {
  localStorage.setItem(JWT_KEY, token)
}

export function clearJwt(): void {
  localStorage.removeItem(JWT_KEY)
}

// Central fetch helper — attaches Bearer token to all requests.
// On 401, clears the token and redirects to /login.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jwt = getJwt()
  const headers = new Headers(init.headers as HeadersInit)
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`)
  const res = await fetch(path, { ...init, headers })
  if (res.status === 401) {
    clearJwt()
    window.location.href = '/login'
  }
  return res
}

// ─── AuthProvider ─────────────────────────────────────────────────────────────

type AuthState = AuthUser | null | 'loading'

interface Props { children: ReactNode }

export function AuthProvider({ children }: Props) {
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    const jwt = getJwt()
    if (!jwt) { setState(null); return }
    fetch('/auth/me', { headers: { Authorization: `Bearer ${jwt}` } })
      .then(async (r) => {
        // 404 = single-tenant mode — no auth required; treat as local session
        if (r.status === 404) {
          return { sub: 'local', email: 'local', isAdmin: true } satisfies AuthUser
        }
        if (!r.ok) return null
        return r.json() as Promise<AuthUser>
      })
      .then(setState)
      .catch(() => setState(null))
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!state) return <Navigate to="/login" replace />

  function logout() {
    clearJwt()
    setState(null)
  }

  return (
    <AuthContext.Provider value={{ user: state, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
