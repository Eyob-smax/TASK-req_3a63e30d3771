// REQ: R5/R7/R8 — Workspace integration: mounts REAL CanvasHost + ChatPanel + CommentDrawer
// so the actor-prop contract and the open-comments flow are exercised without stubs.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Keep the page chrome minimal — but do NOT stub CanvasHost / ChatPanel / CommentDrawer.
vi.mock('@/layouts/AppLayout.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))
vi.mock('@/components/workspace/WorkspaceLayout.vue', () => ({
  default: {
    template: `
      <div class="ws-layout">
        <slot name="toolbar" />
        <slot name="tool-sidebar" />
        <slot name="canvas" />
        <slot name="chat-panel" />
        <slot name="activity-panel" />
        <slot name="member-list" />
        <slot name="snapshot-drawer" />
        <slot name="comment-drawer" />
      </div>
    `,
  },
}))
vi.mock('@/components/workspace/WorkspaceToolbar.vue', () => ({
  default: {
    template: '<div class="ws-toolbar-stub" />',
    emits: ['tool-change', 'open-snapshots', 'open-members', 'open-backup', 'open-pairing'],
  },
}))
vi.mock('@/components/workspace/WorkspaceToolSidebar.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('@/components/workspace/ActivityFeedPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/workspace/MemberListSidebar.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/workspace/SnapshotDrawer.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/workspace/PairingPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/workspace/PresenceAvatarStack.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/workspace/CursorOverlay.vue', () => ({
  default: {
    props: ['selfMemberId'],
    template: '<div class="cursor-overlay-stub" />',
  },
}))

// Stub adaptors + autosave so mount does not start background work
vi.mock('@/services/broadcast-adaptor', () => ({
  attachRoomBroadcast: vi.fn(() => () => {}),
}))
vi.mock('@/services/webrtc-adaptor', () => ({
  attachWebRTCAdaptor: vi.fn(() => () => {}),
}))
vi.mock('@/engine/autosave-scheduler', () => ({
  startRoomScheduler: vi.fn(),
  stopRoomScheduler: vi.fn(),
}))

// Stub collab-publisher so publish* calls triggered by real store paths do not reach the adaptors
vi.mock('@/services/collab-publisher', () => ({
  publishElement: vi.fn(),
  publishChat: vi.fn(),
  publishPin: vi.fn(),
  publishMembership: vi.fn(),
  publishSnapshot: vi.fn(),
  publishRollback: vi.fn(),
  publishConflict: vi.fn(),
  publishPresence: vi.fn(),
}))

import WorkspacePage from '@/pages/WorkspacePage.vue'
import { useRoomStore } from '@/stores/room-store'
import { useElementStore } from '@/stores/element-store'
import { useChatStore } from '@/stores/chat-store'
import { useCommentStore } from '@/stores/comment-store'
import { useSnapshotStore } from '@/stores/snapshot-store'
import { useActivityStore } from '@/stores/activity-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useSessionStore } from '@/stores/session-store'
import CanvasHost from '@/components/workspace/CanvasHost.vue'
import ChatPanel from '@/components/workspace/ChatPanel.vue'
import CommentDrawer from '@/components/workspace/CommentDrawer.vue'
import { RoomRole, MembershipState } from '@/models/room'

async function mountIntegrated(opts: { memberState?: MembershipState | null; pairingCode?: string } = {}) {
  const memberState = opts.memberState === undefined ? MembershipState.Active : opts.memberState
  const room = useRoomStore()
  const session = useSessionStore()
  session.activeProfileId = 'me'
  session.activeProfile = { profileId: 'me', displayName: 'Me', avatarColor: '#f00' } as any
  vi.spyOn(room, 'loadRoom').mockImplementation(async () => {
    room.activeRoom = { roomId: 'room-1', name: 'R', pairingCode: opts.pairingCode } as any
    room.members = memberState === null
      ? []
      : [
          {
            memberId: 'me',
            roomId: 'room-1',
            displayName: 'Me',
            role: RoomRole.Participant,
            state: memberState,
            avatarColor: '#f00',
            joinedAt: '2026-04-01T00:00:00Z',
            updatedAt: '2026-04-01T00:00:00Z',
          } as any,
        ]
  })
  const element = useElementStore()
  const chat = useChatStore()
  const comment = useCommentStore()
  const snapshot = useSnapshotStore()
  const activity = useActivityStore()
  const presence = usePresenceStore()
  vi.spyOn(element, 'loadElements').mockResolvedValue(undefined as any)
  vi.spyOn(chat, 'loadChat').mockResolvedValue(undefined as any)
  vi.spyOn(comment, 'loadThreads').mockResolvedValue(undefined as any)
  vi.spyOn(snapshot, 'refresh').mockResolvedValue(undefined as any)
  vi.spyOn(activity, 'refresh').mockResolvedValue(undefined as any)
  vi.spyOn(presence, 'attach').mockImplementation(() => {})
  const wrapper = mount(WorkspacePage, { props: { roomId: 'room-1' } })
  await flushPromises()
  return wrapper
}

describe('WorkspacePage — real child component integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockPush.mockReset()
    vi.clearAllMocks()
  })

  it('mounts real CanvasHost, ChatPanel, and CommentDrawer as child components', async () => {
    const wrapper = await mountIntegrated()
    expect(wrapper.findComponent(CanvasHost).exists()).toBe(true)
    expect(wrapper.findComponent(ChatPanel).exists()).toBe(true)
    expect(wrapper.findComponent(CommentDrawer).exists()).toBe(true)
  })

  it('threads the actor object from WorkspacePage through to each real child via props', async () => {
    const wrapper = await mountIntegrated()
    const canvas = wrapper.findComponent(CanvasHost)
    const chat = wrapper.findComponent(ChatPanel)
    const drawer = wrapper.findComponent(CommentDrawer)

    expect(canvas.props('actor')).toEqual({ memberId: 'me', displayName: 'Me' })
    expect(chat.props('actor')).toEqual({ memberId: 'me', displayName: 'Me' })
    expect(drawer.props('actor')).toEqual({ memberId: 'me', displayName: 'Me' })
  })

  it('opens the comment drawer with the clicked element id when the real CanvasHost emits open-comments', async () => {
    const wrapper = await mountIntegrated()
    const canvas = wrapper.findComponent(CanvasHost)
    canvas.vm.$emit('open-comments', 'el-real-seed')
    await flushPromises()
    const drawer = wrapper.findComponent(CommentDrawer)
    expect(drawer.props('elementId')).toBe('el-real-seed')
  })

  describe('membership denial matrix', () => {
    it('redirects to room-list when profile has no matching member record', async () => {
      await mountIntegrated({ memberState: null })
      expect(mockPush).toHaveBeenCalledWith({ name: 'room-list' })
    })

    it('redirects Requested members to room-join with pairing code', async () => {
      await mountIntegrated({ memberState: MembershipState.Requested, pairingCode: 'PAIR-123' })
      expect(mockPush).toHaveBeenCalledWith({ name: 'room-join', query: { code: 'PAIR-123' } })
    })

    it('redirects PendingSecondApproval members to room-join', async () => {
      await mountIntegrated({ memberState: MembershipState.PendingSecondApproval })
      expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ name: 'room-join' }))
    })

    it('redirects Rejected members to room-list', async () => {
      await mountIntegrated({ memberState: MembershipState.Rejected })
      expect(mockPush).toHaveBeenCalledWith({ name: 'room-list' })
    })

    it('redirects Left members to room-list', async () => {
      await mountIntegrated({ memberState: MembershipState.Left })
      expect(mockPush).toHaveBeenCalledWith({ name: 'room-list' })
    })

    it('does not attach broadcast/webrtc adaptors or load stores for non-Active members', async () => {
      const broadcast = await import('@/services/broadcast-adaptor')
      const webrtc = await import('@/services/webrtc-adaptor')
      await mountIntegrated({ memberState: MembershipState.Requested, pairingCode: 'P-1' })
      expect(broadcast.attachRoomBroadcast).not.toHaveBeenCalled()
      expect(webrtc.attachWebRTCAdaptor).not.toHaveBeenCalled()
      const element = useElementStore()
      expect(element.loadElements).not.toHaveBeenCalled()
    })
  })

  it('updates the presence store and publishes presence when the real CanvasHost emits cursor-move', async () => {
    const wrapper = await mountIntegrated()
    const presence = usePresenceStore()
    const updateSpy = vi.spyOn(presence, 'updateCursor').mockImplementation(() => {})
    const publisher = await import('@/services/collab-publisher')
    const canvas = wrapper.findComponent(CanvasHost)
    canvas.vm.$emit('cursor-move', { x: 42, y: 99 })
    await flushPromises()
    expect(updateSpy).toHaveBeenCalledWith(
      'me',
      expect.objectContaining({ x: 42, y: 99 }),
    )
    expect(publisher.publishPresence).toHaveBeenCalledWith(
      'room-1',
      'me',
      expect.objectContaining({ x: 42, y: 99 }),
      'Me',
      '#f00',
    )
  })
})
