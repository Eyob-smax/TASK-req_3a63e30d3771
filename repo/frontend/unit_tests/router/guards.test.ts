// REQ: R12 — Route guard logic for locked vs unlocked session states
// REQ: R1/R3 — Workspace membership guard (shouldAllowWorkspaceAccess)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  shouldAllowNavigation,
  shouldAllowWorkspaceAccess,
  AUTH_REQUIRED_ROUTES,
  WORKSPACE_ROUTES,
} from '@/router/guards'
import { SessionState } from '@/models/profile'
import { MembershipState, RoomRole } from '@/models/room'

const findMock = vi.fn()
vi.mock('@/services/member-repository', () => ({
  memberRepository: {
    find: (...args: unknown[]) => findMock(...args),
  },
}))

function makeMember(state: MembershipState) {
  return {
    roomId: 'room-1',
    memberId: 'member-1',
    displayName: 'Alice',
    avatarColor: '#fff',
    role: RoomRole.Participant,
    state,
    joinedAt: '2026-01-01T00:00:00.000Z',
    stateChangedAt: '2026-01-01T00:00:00.000Z',
    approvals: [],
  }
}

describe('AUTH_REQUIRED_ROUTES', () => {
  it('includes room-list', () => {
    expect(AUTH_REQUIRED_ROUTES.has('room-list')).toBe(true)
  })

  it('includes workspace', () => {
    expect(AUTH_REQUIRED_ROUTES.has('workspace')).toBe(true)
  })

  it('includes room-create', () => {
    expect(AUTH_REQUIRED_ROUTES.has('room-create')).toBe(true)
  })

  it('includes room-join', () => {
    expect(AUTH_REQUIRED_ROUTES.has('room-join')).toBe(true)
  })

  it('includes workspace-settings', () => {
    expect(AUTH_REQUIRED_ROUTES.has('workspace-settings')).toBe(true)
  })

  it('includes workspace-backup', () => {
    expect(AUTH_REQUIRED_ROUTES.has('workspace-backup')).toBe(true)
  })

  it('does not include home or profile-select', () => {
    expect(AUTH_REQUIRED_ROUTES.has('home')).toBe(false)
    expect(AUTH_REQUIRED_ROUTES.has('profile-select')).toBe(false)
  })
})

describe('shouldAllowNavigation', () => {
  describe('public routes', () => {
    it('allows navigation to home regardless of session state', () => {
      const result = shouldAllowNavigation('home', SessionState.NoProfile)
      expect(result).toBe(true)
    })

    it('allows navigation to profile-select when locked', () => {
      expect(shouldAllowNavigation('profile-select', SessionState.Locked)).toBe(true)
    })

    it('allows navigation to profile-select when forced-sign-out', () => {
      expect(shouldAllowNavigation('profile-select', SessionState.ForcedSignOut)).toBe(true)
    })
  })

  describe('protected routes when unlocked', () => {
    it('allows room-list when Active', () => {
      expect(shouldAllowNavigation('room-list', SessionState.Active)).toBe(true)
    })

    it('allows workspace when Active', () => {
      expect(shouldAllowNavigation('workspace', SessionState.Active)).toBe(true)
    })
  })

  describe('protected routes when locked', () => {
    it('redirects room-list to profile-select when NoProfile', () => {
      const result = shouldAllowNavigation('room-list', SessionState.NoProfile, '/rooms')
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
      expect((result as { query: { redirect: string } }).query.redirect).toBe('/rooms')
    })

    it('redirects workspace to profile-select when Locked', () => {
      const result = shouldAllowNavigation('workspace', SessionState.Locked, '/workspace/r1')
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
    })

    it('redirects workspace to profile-select when InactivityLocked', () => {
      const result = shouldAllowNavigation('workspace', SessionState.InactivityLocked)
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
    })

    it('redirects workspace to profile-select when ForcedSignOut', () => {
      const result = shouldAllowNavigation('workspace', SessionState.ForcedSignOut)
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
    })

    it('redirects room-create to profile-select when NoProfile', () => {
      const result = shouldAllowNavigation('room-create', SessionState.NoProfile, '/rooms/create')
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
    })

    it('redirects room-join to profile-select when Locked', () => {
      const result = shouldAllowNavigation('room-join', SessionState.Locked, '/rooms/join')
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
    })

    it('redirects workspace-settings to profile-select when InactivityLocked', () => {
      const result = shouldAllowNavigation(
        'workspace-settings',
        SessionState.InactivityLocked,
        '/workspace/r1/settings'
      )
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
    })

    it('redirects workspace-backup to profile-select when ForcedSignOut', () => {
      const result = shouldAllowNavigation(
        'workspace-backup',
        SessionState.ForcedSignOut,
        '/workspace/r1/backup'
      )
      expect(result).not.toBe(true)
      expect((result as { name: string }).name).toBe('profile-select')
    })
  })

  describe('edge cases', () => {
    it('allows navigation when routeName is null', () => {
      expect(shouldAllowNavigation(null, SessionState.NoProfile)).toBe(true)
    })

    it('allows navigation when routeName is an unrecognized symbol', () => {
      expect(shouldAllowNavigation(Symbol('unknown'), SessionState.NoProfile)).toBe(true)
    })

    it('redirect query contains the provided path', () => {
      const result = shouldAllowNavigation('room-list', SessionState.Locked, '/rooms?filter=active')
      expect((result as { query: { redirect: string } }).query.redirect).toBe('/rooms?filter=active')
    })
  })
})

describe('WORKSPACE_ROUTES', () => {
  it('includes workspace, workspace-settings, and workspace-backup', () => {
    expect(WORKSPACE_ROUTES.has('workspace')).toBe(true)
    expect(WORKSPACE_ROUTES.has('workspace-settings')).toBe(true)
    expect(WORKSPACE_ROUTES.has('workspace-backup')).toBe(true)
  })

  it('does not include room-list or room-create', () => {
    expect(WORKSPACE_ROUTES.has('room-list')).toBe(false)
    expect(WORKSPACE_ROUTES.has('room-create')).toBe(false)
  })
})

describe('shouldAllowWorkspaceAccess', () => {
  beforeEach(() => {
    findMock.mockReset()
  })

  it('allows navigation for Active members', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Active))
    const result = await shouldAllowWorkspaceAccess('room-1', 'member-1')
    expect(result).toBe(true)
  })

  it('redirects to room-list when no membership record exists', async () => {
    findMock.mockResolvedValueOnce(undefined)
    const result = await shouldAllowWorkspaceAccess('room-1', 'member-1')
    expect(result).toEqual({ name: 'room-list' })
  })

  it('redirects to room-join when membership is Requested', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Requested))
    const result = await shouldAllowWorkspaceAccess('room-1', 'member-1')
    expect(result).toEqual({ name: 'room-join' })
  })

  it('redirects to room-join when membership is PendingSecondApproval', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.PendingSecondApproval))
    const result = await shouldAllowWorkspaceAccess('room-1', 'member-1')
    expect(result).toEqual({ name: 'room-join' })
  })

  it('redirects to room-list when membership is Left', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Left))
    const result = await shouldAllowWorkspaceAccess('room-1', 'member-1')
    expect(result).toEqual({ name: 'room-list' })
  })

  it('redirects to room-list when membership is Rejected', async () => {
    findMock.mockResolvedValueOnce(makeMember(MembershipState.Rejected))
    const result = await shouldAllowWorkspaceAccess('room-1', 'member-1')
    expect(result).toEqual({ name: 'room-list' })
  })

  it('redirects to room-list when roomId is missing', async () => {
    const result = await shouldAllowWorkspaceAccess(undefined, 'member-1')
    expect(result).toEqual({ name: 'room-list' })
    expect(findMock).not.toHaveBeenCalled()
  })

  it('redirects to room-list when profileId is null', async () => {
    const result = await shouldAllowWorkspaceAccess('room-1', null)
    expect(result).toEqual({ name: 'room-list' })
    expect(findMock).not.toHaveBeenCalled()
  })
})
