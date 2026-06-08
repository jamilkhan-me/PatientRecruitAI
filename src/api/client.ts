const API_BASE = import.meta.env.VITE_API_URL ?? '/api'
const TOKEN_KEY = 'recruit-ai-token'

export type ApiRole = 'admin' | 'researcher' | 'recruiter'

export interface ApiUser {
  id: string
  email: string
  name: string
  role: ApiRole
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  accessToken: string
  user: ApiUser
}

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* ignore */ }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.message ?? body.error ?? message
      if (Array.isArray(message)) message = message.join(', ')
    } catch { /* ignore */ }
    throw new ApiError(message, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  forgotPassword: (email: string) =>
    request<{ message: string; expiresInMinutes: number; resetCode?: string; demoNote?: string }>(
      '/auth/forgot-password',
      { method: 'POST', body: JSON.stringify({ email }) },
    ),

  resetPassword: (email: string, code: string, newPassword: string) =>
    request<{ message: string }>(
      '/auth/reset-password',
      { method: 'POST', body: JSON.stringify({ email, code, newPassword }) },
    ),

  register: (email: string, password: string, name: string, role?: ApiRole) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, role }),
    }),

  me: () => request<ApiUser>('/auth/me'),

  getUsers: () => request<ApiUser[]>('/users'),

  getTrials: (includeArchived = false) =>
    request<Record<string, unknown>[]>(`/trials${includeArchived ? '?includeArchived=true' : ''}`),

  getTrial: (id: string) => request<Record<string, unknown>>(`/trials/${id}`),

  createTrial: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>('/trials', { method: 'POST', body: JSON.stringify(data) }),

  updateTrial: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/trials/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getPatients: (trialId?: string) =>
    request<Record<string, unknown>[]>(`/patients${trialId ? `?trialId=${encodeURIComponent(trialId)}` : ''}`),

  createPatient: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>('/patients', { method: 'POST', body: JSON.stringify(data) }),

  createPatientsBulk: (patients: Record<string, unknown>[]) =>
    request<Record<string, unknown>[]>('/patients/bulk', { method: 'POST', body: JSON.stringify({ patients }) }),

  updatePatient: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
}

export { ApiError }
