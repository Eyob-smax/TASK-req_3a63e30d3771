// REQ: R1–R19 — Workspace page mounts all stores, adaptors, autosave; unmount cleans up
// REQ: R1/R7/R8/R16 — Workspace page wires actor prop + child-emitted contracts (open-comments, open-pairing)
// REQ: R17 — Workspace page wires toolbar open-snapshots / open-members to WorkspaceLayout.openPanel

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/layouts/AppLayout.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

// WorkspaceLayout stub exposes openPanel so WorkspacePage can call it via template ref
const mockOpenPanel = vi.fn()
vi.mock('@/components/workspace/WorkspaceLayout.vue', () => ({
  default: {
    setup() {
      return { openPanel: mockOpenPanel }
    },
    expose: ['openPanel'],
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

// Rich stubs that expose received props so tests can assert the contract
vi.mock('@/components/workspace/WorkspaceToolbar.vue', () => ({
  default: {
    props: [
      'roomName', 'activeTool', 'elementCount', 'memberCount',
      'disabled', 'autosaveStatus', 'lastSavedAt', 'canRollback',
    ],
    emits: ['tool-change', 'open-snapshots', 'open-members', 'open-backup', 'open-pairing'],
    template: `
      <div class="ws-toolbar" :data-disabled="disabled" :data-autosave-status="autosaveStatus" :data-active-tool="activeTool">
        <button data-testid="stub-open-pairing" @click="$emit('open-pairing')">pair</button>
        <button data-testid="stub-open-backup" @click="$emit('open-backup')">backup</button>
        <button data-testid="stub-open-snapshots" @click="$emit('open-snapshots')">snapshots</button>
        <button data-testid="stub-open-members" @click="$emit('open-members')">members</button>
        <button data-testid="stub-tool-pen" @click="$emit('tool-change', 'pen')">pen</button>
      </div>
    `,
  },
}))
vi.mock('@/components/workspace/WorkspaceToolSidebar.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('@/components/workspace/CanvasHost.vue', () => ({
  default: {
    props: ['roomId', 'activeTool', 'actor', 'disabled'],
    emits: ['element-selected', 'open-comments', 'cursor-move'],
    template: `
      <div
        class="canvas-host-stub"
        :data-actor-id="actor?.memberId"
        :data-actor-name="actor?.displayName"
      >
        <button data-testid="stub-open-comments" @click="$emit('open-comments', 'el-seed')">c</button>
        <button data-testid="stub-cursor-move" @click="$emit('cursor-move', { x: 11, y: 22 })">m</button>
      </div>
    `,
  },
}))
vi.mock('@/components/workspace/ChatPanel.vue', () => ({
  default: {
    props: ['roomId', 'actor', 'disabled'],
    template: '<div class="chat-panel-stub" :data-actor-id="actor?.memberId" />',
  },
}))
vi.mock('@/components/workspace/CommentDrawer.vue', () => ({
  default: {
    props: ['elementId', 'roomId', 'actor', 'disabled'],
    template: `
      <div
        class="comment-drawer-stub"
        :data-actor-id="actor?.memberId"
        :data-element-id="elementId"
      />
    `,
  },
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

vi.mock('@/services/broadcast-adaptor', () => ({
  attachRoomBroadcast: vi.fn(() => () => {}),
}))
vi.mock('@/services/webrtc-adaptor', () => ({
  attachWebRTCAdaptor: vi.fn(() => () => {}),
}))
vi.mock('@/services/collab-publisher', () => ({
  publishPresence: vi.fn(),
}))
vi.mock('@/engine/autosave-scheduler', () => ({
  startRoomScheduler: vi.fn(),
  stopRoomScheduler: vi.fn(),
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
import { useUiStore } from '@/stores/ui-store'
import { elementRepository } from '@/services/element-repository'
import { attachRoomBroadcast } from '@/services/broadcast-adaptor'
import { attachWebRTCAdaptor } from '@/services/webrtc-adaptor'
import { startRoomScheduler, stopRoomScheduler } from '@/engine/autosave-scheduler'
import { RoomRole, MembershipState } from '@/models/room'
import { usePreferencesStore } from '@/stores/preferences-store'
import { publishPresence } from '@/services/collab-publisher'

function mountPage(roomId = 'room-1') {
  return mount(WorkspacePage, { props: { roomId } })
}

async function mountWithActiveMember() {
  const room = useRoomStore()
  const session = useSessionStore()
  session.activeProfileId = 'me'
  session.activeProfile = { profileId: 'me', displayName: 'Me', avatarColor: '#f00' } as any
  vi.spyOn(room, 'loadRoom').mockImplementation(async () => {
    room.activeRoom = { roomId: 'room-1', name: 'R' } as any
    room.members = [
      {
        memberId: 'me',
        roomId: 'room-1',
        displayName: 'Me',
        role: RoomRole.Participant,
        state: MembershipState.Active,
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
  const wrapper = mountPage('room-1')
  await flushPromises()
  return wrapper
}

describe('WorkspacePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockPush.mockReset()
    mockOpenPanel.mockReset()
    vi.clearAllMocks()
  })

  it('loads room + elements + chat + threads + snapshots + activity on mount', async () => {
    const room = useRoomStore()
    const element = useElementStore()
    const chat = useChatStore()
    const comment = useCommentStore()
    const snapshot = useSnapshotStore()
    const activity = useActivityStore()
    const presence = usePresenceStore()
    vi.spyOn(room, 'loadRoom').mockImplementation(async () => {
      room.activeRoom = { roomId: 'room-1', name: 'R' } as any
    })
    vi.spyOn(element, 'loadElements').mockResolvedValue(undefined as any)
    vi.spyOn(chat, 'loadChat').mockResolvedValue(undefined as any)
    vi.spyOn(comment, 'loadThreads').mockResolvedValue(undefined as any)
    vi.spyOn(snapshot, 'refresh').mockResolvedValue(undefined as any)
    vi.spyOn(activity, 'refresh').mockResolvedValue(undefined as any)
    vi.spyOn(presence, 'attach').mockImplementation(() => {})

    mountPage('room-1')
    await flushPromises()

    expect(room.loadRoom).toHaveBeenCalledWith('room-1')
    expect(element.loadElements).toHaveBeenCalledWith('room-1')
    expect(chat.loadChat).toHaveBeenCalledWith('room-1')
    expect(comment.loadThreads).toHaveBeenCalledWith('room-1')
    expect(snapshot.refresh).toHaveBeenCalledWith('room-1')
    expect(activity.refresh).toHaveBeenCalledWith('room-1')
    expect(presence.attach).toHaveBeenCalledWith('room-1')
    expect(attachRoomBroadcast).toHaveBeenCalledWith('room-1')
    expect(attachWebRTCAdaptor).toHaveBeenCalledWith('room-1')
    expect(startRoomScheduler).toHaveBeenCalled()
  })

  it('redirects to /rooms when the room is not found', async () => {
    const room = useRoomStore()
    vi.spyOn(room, 'loadRoom').mockImplementation(async () => {
      room.activeRoom = null
    })
    mountPage()
    await flushPromises()
    expect(mockPush).toHaveBeenCalledWith({ name: 'room-list' })
  })

  it('calls stopRoomScheduler on unmount', async () => {
    const room = useRoomStore()
    vi.spyOn(room, 'loadRoom').mockImplementation(async () => {
      room.activeRoom = { roomId: 'room-1', name: 'R' } as any
    })
    const wrapper = mountPage('room-1')
    await flushPromises()
    wrapper.unmount()
    expect(stopRoomScheduler).toHaveBeenCalledWith('room-1')
  })

  it('surfaces stale-state banner when active member is Left', async () => {
    const room = useRoomStore()
    const session = useSessionStore()
    const ui = useUiStore()
    session.activeProfileId = 'me'
    vi.spyOn(room, 'loadRoom').mockImplementation(async () => {
      room.activeRoom = { roomId: 'room-1', name: 'R' } as any
      room.members = [
        {
          memberId: 'me',
          roomId: 'room-1',
          displayName: 'Me',
          role: RoomRole.Participant,
          state: MembershipState.Active,
          avatarColor: '#f00',
          joinedAt: '2026-04-01T00:00:00Z',
          updatedAt: '2026-04-01T00:00:00Z',
        } as any,
      ]
    })
    const bannerSpy = vi.spyOn(ui, 'addBanner')
    mountPage('room-1')
    await flushPromises()
    room.members = [
      { ...room.members[0], state: MembershipState.Left } as any,
    ]
    await flushPromises()
    expect(bannerSpy).toHaveBeenCalled()
    const warnings = bannerSpy.mock.calls.filter((c) => c[1] === 'warning')
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('shows an error toast when loadRoom throws', async () => {
    const room = useRoomStore()
    const ui = useUiStore()
    vi.spyOn(room, 'loadRoom').mockRejectedValue(new Error('fail'))
    const toastSpy = vi.spyOn(ui.toast, 'error')
    mountPage()
    await flushPromises()
    expect(toastSpy).toHaveBeenCalled()
  })

  it('passes actor prop to CanvasHost, ChatPanel, and CommentDrawer', async () => {
    const wrapper = await mountWithActiveMember()
    const canvas = wrapper.find('.canvas-host-stub')
    const chat = wrapper.find('.chat-panel-stub')
    const drawer = wrapper.find('.comment-drawer-stub')
    expect(canvas.exists()).toBe(true)
    expect(chat.exists()).toBe(true)
    expect(drawer.exists()).toBe(true)
    expect(canvas.attributes('data-actor-id')).toBe('me')
    expect(canvas.attributes('data-actor-name')).toBe('Me')
    expect(chat.attributes('data-actor-id')).toBe('me')
    expect(drawer.attributes('data-actor-id')).toBe('me')
  })

  it('opens the comment drawer when CanvasHost emits open-comments', async () => {
    const wrapper = await mountWithActiveMember()
    const drawer = wrapper.find('.comment-drawer-stub')
    // Before: elementId is empty (drawer hidden)
    expect(drawer.attributes('data-element-id')).toBe('')
    await wrapper.find('[data-testid="stub-open-comments"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.comment-drawer-stub').attributes('data-element-id')).toBe('el-seed')
  })

  it('opens the pairing panel when WorkspaceToolbar emits open-pairing', async () => {
    const wrapper = await mountWithActiveMember()
    expect(wrapper.find('.workspace-page__pairing-overlay').exists()).toBe(false)
    await wrapper.find('[data-testid="stub-open-pairing"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-page__pairing-overlay').exists()).toBe(true)
  })

  it('closes the pairing panel when close button is clicked', async () => {
    const wrapper = await mountWithActiveMember()
    await wrapper.find('[data-testid="stub-open-pairing"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.workspace-page__pairing-overlay').exists()).toBe(true)
    await wrapper.find('.workspace-page__pairing-close').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-page__pairing-overlay').exists()).toBe(false)
  })

  it('opens backup route when toolbar emits open-backup', async () => {
    const wrapper = await mountWithActiveMember()
    await wrapper.find('[data-testid="stub-open-backup"]').trigger('click')
    await flushPromises()

    expect(mockPush).toHaveBeenCalledWith({ name: 'workspace-backup', params: { roomId: 'room-1' } })
  })

  it('updates active tool and persists preference when toolbar emits tool-change', async () => {
    const preferences = usePreferencesStore()
    const setLastToolSpy = vi.spyOn(preferences, 'setLastTool')

    const wrapper = await mountWithActiveMember()
    expect(wrapper.find('.ws-toolbar').attributes('data-active-tool')).toBe('select')

    await wrapper.find('[data-testid="stub-tool-pen"]').trigger('click')
    await flushPromises()

    expect(setLastToolSpy).toHaveBeenCalledWith('pen')
    expect(wrapper.find('.ws-toolbar').attributes('data-active-tool')).toBe('pen')
  })

  it('handles cursor-move by updating presence store and publishing presence', async () => {
    const presence = usePresenceStore()
    const updateCursorSpy = vi.spyOn(presence, 'updateCursor').mockImplementation(() => {})

    const wrapper = await mountWithActiveMember()
    await wrapper.find('[data-testid="stub-cursor-move"]').trigger('click')
    await flushPromises()

    expect(updateCursorSpy).toHaveBeenCalledWith(
      'me',
      expect.objectContaining({ x: 11, y: 22 })
    )
    expect(publishPresence).toHaveBeenCalledWith(
      'room-1',
      'me',
      expect.objectContaining({ x: 11, y: 22 }),
      'Me',
      '#f00'
    )
  })

  it('calls openPanel("snapshots") on WorkspaceLayout when toolbar emits open-snapshots', async () => {
    const wrapper = await mountWithActiveMember()
    await wrapper.find('[data-testid="stub-open-snapshots"]').trigger('click')
    await flushPromises()
    expect(mockOpenPanel).toHaveBeenCalledWith('snapshots')
  })

  it('calls openPanel("members") on WorkspaceLayout when toolbar emits open-members', async () => {
    const wrapper = await mountWithActiveMember()
    await wrapper.find('[data-testid="stub-open-members"]').trigger('click')
    await flushPromises()
    expect(mockOpenPanel).toHaveBeenCalledWith('members')
  })

  async function mountAndCaptureScheduler() {
    let capturedOnAutoSave: (() => Promise<void>) | null = null
    const { startRoomScheduler } = await import('@/engine/autosave-scheduler')
    vi.mocked(startRoomScheduler).mockImplementationOnce((_roomId, callbacks) => {
      capturedOnAutoSave = callbacks.onAutoSave
    })
    const room = useRoomStore()
    vi.spyOn(room, 'loadRoom').mockImplementation(async () => {
      room.activeRoom = { roomId: 'room-1', name: 'R' } as any
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
    const wrapper = mountPage('room-1')
    await flushPromises()
    return { wrapper, capturedOnAutoSave: capturedOnAutoSave!, element, chat, comment }
  }

  it('autosave heartbeat sets status to "saved" when no store has an error', async () => {
    const { wrapper, capturedOnAutoSave } = await mountAndCaptureScheduler()
    expect(capturedOnAutoSave).not.toBeNull()
    await capturedOnAutoSave()
    await flushPromises()
    expect(wrapper.find('.ws-toolbar').attributes('data-autosave-status')).toBe('saved')
  })

  it('autosave heartbeat sets status to "failed" when element store has an error', async () => {
    const { wrapper, capturedOnAutoSave, element } = await mountAndCaptureScheduler()
    element.lastError = 'Write failed'
    await capturedOnAutoSave()
    await flushPromises()
    expect(wrapper.find('.ws-toolbar').attributes('data-autosave-status')).toBe('failed')
  })

  it('autosave heartbeat sets status to "failed" when chat store has an error', async () => {
    const { wrapper, capturedOnAutoSave, chat } = await mountAndCaptureScheduler()
    chat.lastError = 'Write failed'
    await capturedOnAutoSave()
    await flushPromises()
    expect(wrapper.find('.ws-toolbar').attributes('data-autosave-status')).toBe('failed')
  })

  it('autosave heartbeat sets status to "failed" when IndexedDB countByRoom throws', async () => {
    const { wrapper, capturedOnAutoSave } = await mountAndCaptureScheduler()
    vi.spyOn(elementRepository, 'countByRoom').mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    await capturedOnAutoSave()
    await flushPromises()
    expect(wrapper.find('.ws-toolbar').attributes('data-autosave-status')).toBe('failed')
  })
})
