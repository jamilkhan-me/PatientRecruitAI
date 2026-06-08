import { useCallback, useEffect, useRef } from 'react'

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const

function throttle(fn: () => void, ms: number) {
  let last = 0
  return () => {
    const now = Date.now()
    if (now - last >= ms) {
      last = now
      fn()
    }
  }
}

const DEFAULT_IDLE_MS = Number(import.meta.env.VITE_SESSION_IDLE_MINUTES ?? 30) * 60 * 1000
const DEFAULT_WARNING_MS = 60 * 1000

export function getSessionIdleTimeoutMs() {
  return Number.isFinite(DEFAULT_IDLE_MS) && DEFAULT_IDLE_MS > 0 ? DEFAULT_IDLE_MS : 30 * 60 * 1000
}

export function useIdleTimeout(options: {
  enabled: boolean
  timeoutMs?: number
  warningBeforeMs?: number
  onTimeout: () => void
  onWarning?: () => void
  onActivity?: () => void
}) {
  const {
    enabled,
    timeoutMs = getSessionIdleTimeoutMs(),
    warningBeforeMs = DEFAULT_WARNING_MS,
    onTimeout,
    onWarning,
    onActivity,
  } = options

  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const warningRef = useRef<ReturnType<typeof setTimeout>>()
  const onTimeoutRef = useRef(onTimeout)
  const onWarningRef = useRef(onWarning)
  const onActivityRef = useRef(onActivity)

  onTimeoutRef.current = onTimeout
  onWarningRef.current = onWarning
  onActivityRef.current = onActivity

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (warningRef.current) clearTimeout(warningRef.current)
    timeoutRef.current = undefined
    warningRef.current = undefined
  }, [])

  const resetTimer = useCallback((fromActivity = false) => {
    clearTimers()
    if (!enabled) return
    if (fromActivity) onActivityRef.current?.()

    const warnAt = timeoutMs - warningBeforeMs
    if (onWarningRef.current && warnAt > 0) {
      warningRef.current = setTimeout(() => onWarningRef.current?.(), warnAt)
    }
    timeoutRef.current = setTimeout(() => onTimeoutRef.current(), timeoutMs)
  }, [clearTimers, enabled, timeoutMs, warningBeforeMs])

  useEffect(() => {
    if (!enabled) {
      clearTimers()
      return
    }

    resetTimer(false)
    const onUserActivity = throttle(() => resetTimer(true), 1000)
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onUserActivity, { passive: true }))
    const onVisible = () => {
      if (document.visibilityState === 'visible') resetTimer(true)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimers()
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onUserActivity))
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [clearTimers, enabled, resetTimer])

  return { resetTimer: () => resetTimer(true) }
}
