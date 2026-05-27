import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface AuthUser {
  username: string
  puzzle_elo: number
  token: string
}

interface AuthContextValue {
  user: AuthUser | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateElo: (newElo: number) => void
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'chess_puzzle_user'

function loadStoredUser(): AuthUser | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser)

  const saveUser = (u: AuthUser | null) => {
    setUser(u)
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    else localStorage.removeItem(STORAGE_KEY)
  }

  const authFetch = useCallback(
    (url: string, options: RequestInit = {}) => {
      const token = user?.token
      return fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Token ${token}` } : {}),
          ...(options.headers as Record<string, string> | undefined),
        },
      })
    },
    [user],
  )

  const login = async (username: string, password: string) => {
    const res = await fetch('http://localhost:8000/api/auth/login/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || 'Login failed')
    saveUser({ username: data.username, puzzle_elo: data.puzzle_elo, token: data.token })
  }

  const register = async (username: string, password: string) => {
    const res = await fetch('http://localhost:8000/api/auth/register/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.detail || 'Registration failed')
    saveUser({ username: data.username, puzzle_elo: data.puzzle_elo, token: data.token })
  }

  const logout = async () => {
    if (user) {
      await fetch('http://localhost:8000/api/auth/logout/', {
        method: 'POST',
        headers: { Authorization: `Token ${user.token}` },
      }).catch(() => {})
    }
    saveUser(null)
  }

  const updateElo = (newElo: number) => {
    if (user) saveUser({ ...user, puzzle_elo: newElo })
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout, updateElo, authFetch }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
