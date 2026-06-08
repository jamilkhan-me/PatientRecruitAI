import type { DemoUser } from '../App'

let orgUsersCache: DemoUser[] = []

export function setOrgUsersCache(users: DemoUser[]) {
  orgUsersCache = users
}

export function getOrgUsersCache(): DemoUser[] {
  return orgUsersCache
}

export function resolveUserName(id: string, fallback = 'User'): string {
  return orgUsersCache.find((u) => u.id === id)?.name ?? fallback
}
