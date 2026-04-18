// REQ: R12 — Route guards for locked vs unlocked session states
// REQ: R13 — Redirect to /profile when inactivity lock or forced sign-out fires
// REQ: R1/R3 — Workspace routes additionally require active room membership

import type { Router, RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import { SessionState } from '@/models/profile'
import { MembershipState } from '@/models/room'
import { useSessionStore } from '@/stores/session-store'
import { memberRepository } from '@/services/member-repository'

/**
 * Route names that require an active (unlocked) session.
 * Any route NOT in this set is considered public.
 */
export const AUTH_REQUIRED_ROUTES = new Set<string>([
  'room-list',
  'room-create',
  'room-join',
  'workspace',
  'workspace-settings',
  'workspace-backup',
])

/**
 * Pure guard logic — determines whether navigation should proceed.
 * Extracted as a standalone function for easy unit testing.
 *
 * @param routeName    - the target route name (string | null | symbol)
 * @param sessionState - the caller-supplied current session state
 * @param redirectPath - full path string to pass as redirect query on deny
 * @returns true to allow, or a route descriptor to redirect to /profile
 */
export function shouldAllowNavigation(
  routeName: string | null | symbol,
  sessionState: SessionState,
  redirectPath = ''
): true | { name: string; query: { redirect: string } } {
  if (!AUTH_REQUIRED_ROUTES.has(String(routeName))) return true
  if (sessionState === SessionState.Active) return true
  return { name: 'profile-select', query: { redirect: redirectPath } }
}

/**
 * Install the global session navigation guard on the given router.
 *
 * Pinia must be installed on the app before any navigation guard fires.
 * This is guaranteed because app.use(createPinia()) runs before app.use(router)
 * in main.ts, and guards only fire on navigation events after app.mount().
 *
 * The useSessionStore import is safe here — the store factory function is imported
 * at module evaluation time, but the store itself is only accessed (via `useSessionStore()`)
 * when the guard fires, by which point Pinia is initialized.
 */
export function installSessionGuard(router: Router): void {
  router.beforeEach((to: RouteLocationNormalized) => {
    const session = useSessionStore()
    return shouldAllowNavigation(to.name, session.sessionState, to.fullPath)
  })
}

/**
 * Route names that resolve to the collaboration workspace. These routes
 * additionally require an *active* room membership, not just an unlocked session.
 */
export const WORKSPACE_ROUTES = new Set<string>([
  'workspace',
  'workspace-settings',
  'workspace-backup',
])

/**
 * Pure async guard deciding whether a profile is allowed to open a workspace route.
 *
 * Returns `true` when the member record exists for (roomId, profileId) and is Active.
 * Otherwise returns a redirect descriptor:
 *   - Requested / PendingSecondApproval → `room-join` (awaiting approval surface)
 *   - Left / Rejected / missing → `room-list`
 *
 * Extracted as a pure function so it can be unit-tested without a router.
 */
export async function shouldAllowWorkspaceAccess(
  roomId: string | undefined,
  profileId: string | null,
): Promise<true | RouteLocationRaw> {
  if (!roomId || !profileId) {
    return { name: 'room-list' }
  }
  const member = await memberRepository.find(roomId, profileId)
  if (!member) {
    return { name: 'room-list' }
  }
  if (member.state === MembershipState.Active) {
    return true
  }
  if (
    member.state === MembershipState.Requested ||
    member.state === MembershipState.PendingSecondApproval
  ) {
    return { name: 'room-join' }
  }
  return { name: 'room-list' }
}

/**
 * Install the workspace membership guard. Runs after the session guard so that
 * unlocked-but-non-member navigation cannot reach the workspace surface.
 *
 * Public and non-workspace routes are allowed through unchanged.
 */
export function installWorkspaceMembershipGuard(router: Router): void {
  router.beforeEach(async (to: RouteLocationNormalized) => {
    if (!WORKSPACE_ROUTES.has(String(to.name))) return true

    const session = useSessionStore()
    if (session.sessionState !== SessionState.Active) {
      // Session guard already redirected; let that decision stand.
      return true
    }

    const roomId = typeof to.params.roomId === 'string' ? to.params.roomId : undefined
    return shouldAllowWorkspaceAccess(roomId, session.activeProfileId)
  })
}
