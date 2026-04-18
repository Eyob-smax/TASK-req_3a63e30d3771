// REQ: R12/R13 — Router navigation integration with real guards and session state
// REQ: R1/R3 — Workspace membership guard denies non-Active members at the route layer

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { routes } from '@/router'
import { installSessionGuard, installWorkspaceMembershipGuard } from '@/router/guards'
import { SessionState } from '@/models/profile'
import { MembershipState, RoomRole } from '@/models/room'
import { useSessionStore } from '@/stores/session-store'

const findMock = vi.fn()
vi.mock('@/services/member-repository', () => ({
  memberRepository: {
    find: (...args: unknown[]) => findMock(...args),
  },
}))

function makeMember(state: MembershipState) {
  return {
    roomId: 'room-42',
    memberId: 'me',
    displayName: 'Me',
    avatarColor: '#fff',
    role: RoomRole.Participant,
    state,
    joinedAt: '2026-01-01T00:00:00.000Z',
    stateChangedAt: '2026-01-01T00:00:00.000Z',
    approvals: [],
  }
}

const PUBLIC_PATHS = ['/', '/profile']
const GUARDED_PATHS = [
  '/rooms',
  '/rooms/create',
  '/rooms/join',
  '/workspace/room-42',
  '/workspace/room-42/settings',
  '/workspace/room-42/backup',
]

const LOCKED_STATES = [
  SessionState.NoProfile,
  SessionState.Locked,
  SessionState.InactivityLocked,
  SessionState.ForcedSignOut,
]

function createGuardedRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  installSessionGuard(router)
  return router
}

describe('router navigation integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it.each(PUBLIC_PATHS)(
    'allows public navigation to %s without active session',
    async (path) => {
      const router = createGuardedRouter()
      const session = useSessionStore()
      session.sessionState = SessionState.NoProfile

      await router.push(path)

      expect(router.currentRoute.value.path).toBe(path)
    }
  )

  it.each(LOCKED_STATES)(
    'redirects all guarded paths to /profile when session state is %s',
    async (state) => {
      const session = useSessionStore()
      session.sessionState = state

      for (const target of GUARDED_PATHS) {
        const router = createGuardedRouter()
        await router.push(target)

        expect(router.currentRoute.value.name).toBe('profile-select')
        expect(router.currentRoute.value.query.redirect).toBe(target)
      }
    }
  )

  it.each(GUARDED_PATHS)(
    'allows guarded navigation to %s when session is active',
    async (target) => {
      const router = createGuardedRouter()
      const session = useSessionStore()
      session.sessionState = SessionState.Active

      await router.push(target)

      expect(router.currentRoute.value.fullPath).toBe(target)
    }
  )

  it('preserves roomId params for workspace routes when active', async () => {
    const router = createGuardedRouter()
    const session = useSessionStore()
    session.sessionState = SessionState.Active

    await router.push('/workspace/alpha-room')
    expect(router.currentRoute.value.params.roomId).toBe('alpha-room')

    await router.push('/workspace/beta-room/settings')
    expect(router.currentRoute.value.params.roomId).toBe('beta-room')

    await router.push('/workspace/gamma-room/backup')
    expect(router.currentRoute.value.params.roomId).toBe('gamma-room')
  })
})

describe('workspace membership guard integration', () => {
  function createMembershipGuardedRouter() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    })
    installSessionGuard(router)
    installWorkspaceMembershipGuard(router)
    return router
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    findMock.mockReset()
  })

  it('allows Active member to reach /workspace/:roomId', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Active))
    const session = useSessionStore()
    session.sessionState = SessionState.Active
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/workspace/room-42')
    expect(router.currentRoute.value.name).toBe('workspace')
    expect(router.currentRoute.value.params.roomId).toBe('room-42')
  })

  it('redirects Requested member to room-join', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Requested))
    const session = useSessionStore()
    session.sessionState = SessionState.Active
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/workspace/room-42')
    expect(router.currentRoute.value.name).toBe('room-join')
  })

  it('redirects PendingSecondApproval member to room-join', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.PendingSecondApproval))
    const session = useSessionStore()
    session.sessionState = SessionState.Active
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/workspace/room-42')
    expect(router.currentRoute.value.name).toBe('room-join')
  })

  it('redirects Left member to room-list', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Left))
    const session = useSessionStore()
    session.sessionState = SessionState.Active
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/workspace/room-42')
    expect(router.currentRoute.value.name).toBe('room-list')
  })

  it('redirects Rejected member to room-list', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Rejected))
    const session = useSessionStore()
    session.sessionState = SessionState.Active
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/workspace/room-42')
    expect(router.currentRoute.value.name).toBe('room-list')
  })

  it('redirects unknown member (no membership record) to room-list', async () => {
    findMock.mockResolvedValueOnce(undefined)
    const session = useSessionStore()
    session.sessionState = SessionState.Active
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/workspace/room-42')
    expect(router.currentRoute.value.name).toBe('room-list')
  })

  it('leaves non-workspace routes alone (membership guard bypassed)', async () => {
    const session = useSessionStore()
    session.sessionState = SessionState.Active
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/rooms')
    expect(router.currentRoute.value.name).toBe('room-list')
    expect(findMock).not.toHaveBeenCalled()
  })

  it('defers to session guard when session is not Active (no membership lookup)', async () => {
    const session = useSessionStore()
    session.sessionState = SessionState.Locked
    session.activeProfileId = 'me'
    const router = createMembershipGuardedRouter()
    await router.push('/workspace/room-42')
    expect(router.currentRoute.value.name).toBe('profile-select')
    expect(findMock).not.toHaveBeenCalled()
  })
})
