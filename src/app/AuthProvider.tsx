import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

export type AuthUser = { id: string; username: string }

const CACHED_USER_KEY = "memento-auth-user"

class AuthRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string, inviteCode: string): Promise<void>;
  logout(): Promise<void>;
  sessionExpired(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function request<T>(url: string, body?: Record<string, string>): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" })
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error("网络连接失败，请稍后再试。")
  }
  const value = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new AuthRequestError(value.error ?? "请求失败，请稍后再试。", response.status)
  return value
}

function readCachedUser(): AuthUser | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CACHED_USER_KEY) ?? "null")
    if (typeof value !== "object" || value === null) return null
    const candidate = value as Record<string, unknown>
    return typeof candidate.id === "string" && candidate.id.length > 0 && typeof candidate.username === "string" && candidate.username.length > 0
      ? { id: candidate.id, username: candidate.username }
      : null
  } catch {
    return null
  }
}

function cacheUser(user: AuthUser): void {
  try {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user))
  } catch {
    // Local storage is an offline convenience. The authenticated session remains authoritative.
  }
}

function clearCachedUser(): void {
  try {
    localStorage.removeItem(CACHED_USER_KEY)
  } catch {
    // Ignore storage failures while clearing a non-authoritative cache.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void request<{ user: AuthUser | null }>("/api/auth/session")
      .then((result) => {
        if (!active) return
        if (result.user) cacheUser(result.user)
        else clearCachedUser()
        setUser(result.user)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof AuthRequestError && (cause.status === 401 || cause.status === 403)) {
          clearCachedUser()
          setUser(null)
          return
        }
        // A failed session check can be a temporary network outage. Keep the
        // last confirmed identity only as a local database key; the next cloud
        // request still has to authenticate normally.
        setUser(readCachedUser())
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const sessionExpired = useCallback(() => {
    clearCachedUser()
    sessionStorage.removeItem("memento-new-user")
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    async login(username, password) {
      const result = await request<{ user: AuthUser }>("/api/auth/login", { username, password })
      cacheUser(result.user)
      setUser(result.user)
    },
    async register(username, password, inviteCode) {
      const result = await request<{ user: AuthUser }>("/api/auth/register", { username, password, inviteCode })
      cacheUser(result.user)
      sessionStorage.setItem("memento-new-user", result.user.id)
      setUser(result.user)
    },
    async logout() {
      await request("/api/auth/logout", {})
      clearCachedUser()
      sessionStorage.removeItem("memento-new-user")
      setUser(null)
    },
    sessionExpired,
  }), [loading, sessionExpired, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider.")
  return value
}
