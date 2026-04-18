// REQ: R8 — Chat store: loadChat, sendMessage, pinMessage, unpinMessage
// REQ: R18/R19 — chat-store publishes BroadcastChannel + WebRTC messages on successful writes via collab-publisher

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore } from '@/stores/chat-store'
import { RoomRole } from '@/models/room'

const mockMessage = {
  messageId: 'msg-1',
  roomId: 'room-1',
  authorId: 'member-1',
  authorDisplayName: 'Alice',
  authorAvatarColor: '#ff0000',
  text: 'Hello world',
  sentAt: '2026-01-01T00:00:00.000Z',
  isPinned: false,
  isDeleted: false,
}

const mockPinned = {
  pinnedId: 'pin-1',
  messageId: 'msg-1',
  roomId: 'room-1',
  pinnedBy: 'member-1',
  pinnedByName: 'Alice',
  pinnedAt: '2026-01-01T00:00:00.000Z',
}

vi.mock('@/engine/chat-engine', () => ({
  listRecent: vi.fn(async () => [mockMessage]),
  listPinned: vi.fn(async () => [mockPinned]),
  sendMessage: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    message: { ...mockMessage, messageId: 'msg-2' },
  })),
  pinMessage: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    pinned: { ...mockPinned, pinnedId: 'pin-2', messageId: 'msg-2' },
  })),
  unpinMessage: vi.fn(async () => ({
    valid: true,
    errors: [],
  })),
}))

const mockPublishChat = vi.fn()
const mockPublishPin = vi.fn()
const mockPublishConflict = vi.fn()
vi.mock('@/services/collab-publisher', () => ({
  publishChat: (...args: any[]) => mockPublishChat(...args),
  publishPin: (...args: any[]) => mockPublishPin(...args),
  publishConflict: (...args: any[]) => mockPublishConflict(...args),
}))

vi.mock('@/services/broadcast-channel-service', () => ({
  getLocalTabId: () => 'tab-test',
}))

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

let membershipGateResult: { valid: boolean; errors: any[] } = { valid: true, errors: [] }
vi.mock('@/services/membership-gate', () => ({
  ensureActiveMembership: vi.fn(async () => membershipGateResult),
}))

const actor = { memberId: 'member-1', displayName: 'Alice', role: RoomRole.Reviewer }

describe('chat-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    membershipGateResult = { valid: true, errors: [] }
  })

  describe('loadChat', () => {
    it('loads messages and pinned on happy path', async () => {
      const store = useChatStore()
      await store.loadChat('room-1')
      expect(store.messages).toHaveLength(1)
      expect(store.pinned).toHaveLength(1)
      expect(store.isLoading).toBe(false)
      expect(store.lastError).toBeNull()
    })

    it('sets lastError on failure', async () => {
      const chatEngine = await import('@/engine/chat-engine')
      vi.mocked(chatEngine.listRecent).mockRejectedValueOnce(new Error('DB error'))
      const store = useChatStore()
      await store.loadChat('room-1')
      expect(store.lastError).toBe('Failed to load chat messages.')
    })
  })

  describe('sendMessage', () => {
    it('refreshes message list after sending', async () => {
      const store = useChatStore()
      const result = await store.sendMessage({
        roomId: 'room-1',
        text: 'Hello',
        authorId: 'member-1',
        authorDisplayName: 'Alice',
        authorAvatarColor: '#ff0000',
      })
      expect(result.validation.valid).toBe(true)
      const chatEngine = await import('@/engine/chat-engine')
      expect(chatEngine.listRecent).toHaveBeenCalledWith('room-1')
    })
  })

  describe('pinMessage', () => {
    it('adds pinned entry to pinned list on success', async () => {
      const store = useChatStore()
      await store.loadChat('room-1')
      const before = store.pinned.length
      const result = await store.pinMessage('room-1', 'msg-2', actor)
      expect(result.validation.valid).toBe(true)
      expect(store.pinned.length).toBe(before + 1)
    })
  })

  describe('unpinMessage', () => {
    it('removes unpinned message from pinned list', async () => {
      const store = useChatStore()
      store.pinned = [mockPinned] as any
      const result = await store.unpinMessage('room-1', 'msg-1', actor)
      expect(result.valid).toBe(true)
      expect(store.pinned).toHaveLength(0)
    })
  })

  describe('error handling', () => {
    it('does not mutate pinned list when pinMessage validation fails', async () => {
      const chatEngine = await import('@/engine/chat-engine')
      vi.mocked(chatEngine.pinMessage).mockResolvedValueOnce({
        validation: {
          valid: false,
          errors: [{ field: 'pin', message: 'Pin cap reached.', code: 'limit_exceeded' }],
        },
        pinned: null,
      } as any)
      const store = useChatStore()
      store.pinned = []
      const result = await store.pinMessage('room-1', 'msg-2', actor)
      expect(result.validation.valid).toBe(false)
      expect(store.pinned).toHaveLength(0)
    })

    it('surfaces engine rejection as a toast-friendly error on sendMessage', async () => {
      const chatEngine = await import('@/engine/chat-engine')
      vi.mocked(chatEngine.sendMessage).mockResolvedValueOnce({
        validation: {
          valid: false,
          errors: [{ field: 'text', message: 'Empty.', code: 'required' }],
        },
        message: null,
      } as any)
      const store = useChatStore()
      const result = await store.sendMessage({
        roomId: 'room-1',
        text: '',
        authorId: 'member-1',
        authorDisplayName: 'Alice',
        authorAvatarColor: '#ff0000',
      })
      expect(result.validation.valid).toBe(false)
    })
  })

  describe('collab-publisher integration', () => {
    it('publishes chat-message with op "new" after successful sendMessage', async () => {
      const store = useChatStore()
      await store.sendMessage({
        roomId: 'room-1',
        text: 'Hello',
        authorId: 'member-1',
        authorDisplayName: 'Alice',
        authorAvatarColor: '#ff0000',
      })
      expect(mockPublishChat).toHaveBeenCalledOnce()
      const [roomId, op, messageId] = mockPublishChat.mock.calls[0]
      expect(roomId).toBe('room-1')
      expect(op).toBe('new')
      expect(messageId).toBe('msg-2')
    })

    it('publishes pin-change with op "pin" after successful pinMessage', async () => {
      const store = useChatStore()
      await store.pinMessage('room-1', 'msg-2', actor)
      expect(mockPublishPin).toHaveBeenCalledOnce()
      const [roomId, op, messageId] = mockPublishPin.mock.calls[0]
      expect(roomId).toBe('room-1')
      expect(op).toBe('pin')
      expect(messageId).toBe('msg-2')
    })

    it('publishes pin-change with op "unpin" after successful unpinMessage', async () => {
      const store = useChatStore()
      store.pinned = [mockPinned] as any
      await store.unpinMessage('room-1', 'msg-1', actor)
      expect(mockPublishPin).toHaveBeenCalledOnce()
      const [, op, messageId] = mockPublishPin.mock.calls[0]
      expect(op).toBe('unpin')
      expect(messageId).toBe('msg-1')
    })

    it('does not publish when sendMessage fails', async () => {
      const chatEngine = await import('@/engine/chat-engine')
      vi.mocked(chatEngine.sendMessage).mockResolvedValueOnce({
        validation: { valid: false, errors: [{ field: 'text', message: 'bad', code: 'required' }] },
        message: null,
      } as any)
      const store = useChatStore()
      await store.sendMessage({
        roomId: 'room-1',
        text: '',
        authorId: 'member-1',
        authorDisplayName: 'Alice',
        authorAvatarColor: '#ff0000',
      })
      expect(mockPublishChat).not.toHaveBeenCalled()
    })

    it('publishes pin-collision conflict when pin cap is exceeded', async () => {
      const chatEngine = await import('@/engine/chat-engine')
      vi.mocked(chatEngine.pinMessage).mockResolvedValueOnce({
        validation: {
          valid: false,
          errors: [
            { field: 'pinned', message: 'Pin cap reached.', code: 'max_count', value: 3 },
          ],
        },
      } as any)
      const store = useChatStore()
      await store.pinMessage('room-1', 'msg-3', actor)
      expect(mockPublishConflict).toHaveBeenCalledOnce()
      const [roomId, type, resourceId, tabId, message] = mockPublishConflict.mock.calls[0]
      expect(roomId).toBe('room-1')
      expect(type).toBe('pin-collision')
      expect(resourceId).toBe('msg-3')
      expect(tabId).toBe('tab-test')
      expect(message).toContain('Pin cap')
    })

    it('publishes pin-collision conflict when message is already pinned (duplicate)', async () => {
      const chatEngine = await import('@/engine/chat-engine')
      vi.mocked(chatEngine.pinMessage).mockResolvedValueOnce({
        validation: {
          valid: false,
          errors: [
            { field: 'messageId', message: 'Message is already pinned.', code: 'duplicate', value: 'msg-1' },
          ],
        },
      } as any)
      const store = useChatStore()
      await store.pinMessage('room-1', 'msg-1', actor)
      expect(mockPublishConflict).toHaveBeenCalledOnce()
      const [, type] = mockPublishConflict.mock.calls[0]
      expect(type).toBe('pin-collision')
    })

    it('does not publish conflict when pinMessage succeeds', async () => {
      const store = useChatStore()
      await store.pinMessage('room-1', 'msg-2', actor)
      expect(mockPublishConflict).not.toHaveBeenCalled()
    })
  })

  describe('membership gate enforcement', () => {
    const blocked = {
      valid: false,
      errors: [{ field: 'membershipState', message: 'Non-active member.', code: 'invalid_transition' }],
    }

    it('blocks sendMessage for non-Active members and does not publish', async () => {
      membershipGateResult = blocked
      const store = useChatStore()
      const result = await store.sendMessage({
        roomId: 'room-1',
        text: 'Hello',
        authorId: 'member-1',
        authorDisplayName: 'Alice',
        authorAvatarColor: '#ff0000',
      } as any)
      expect(result.validation.valid).toBe(false)
      const chatEngine = await import('@/engine/chat-engine')
      expect(chatEngine.sendMessage).not.toHaveBeenCalled()
      expect(mockPublishChat).not.toHaveBeenCalled()
    })

    it('blocks pinMessage for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useChatStore()
      const result = await store.pinMessage('room-1', 'msg-2', actor)
      expect(result.validation.valid).toBe(false)
      const chatEngine = await import('@/engine/chat-engine')
      expect(chatEngine.pinMessage).not.toHaveBeenCalled()
      expect(mockPublishPin).not.toHaveBeenCalled()
    })

    it('blocks unpinMessage for non-Active members and leaves pinned list intact', async () => {
      membershipGateResult = blocked
      const store = useChatStore()
      store.pinned = [mockPinned] as any
      const result = await store.unpinMessage('room-1', 'msg-1', actor)
      expect(result.valid).toBe(false)
      expect(store.pinned).toHaveLength(1)
      expect(mockPublishPin).not.toHaveBeenCalled()
    })
  })
})
