// REQ: R17 — Snapshot store: refresh, captureManual, rollback with confirm
// REQ: R17 — Rollback reloads live element/chat/comment stores after completing
// REQ: R18/R19 — snapshot-store publishes snapshot-created + rollback-applied via collab-publisher

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSnapshotStore } from '@/stores/snapshot-store'
import { RoomRole } from '@/models/room'

const mockSnapshot = {
  snapshotId: 'snap-1',
  roomId: 'room-1',
  type: 'manual',
  capturedAt: '2026-01-01T00:00:00.000Z',
  capturedBy: 'member-1',
  elementCount: 5,
  sizeBytes: 1024,
  sequenceNumber: 1,
}

const mockRollbackMetadata = {
  rollbackId: 'rb-1',
  roomId: 'room-1',
  fromSnapshotId: 'snap-1',
  rolledBackBy: 'member-1',
  rolledBackAt: '2026-01-01T00:00:00.000Z',
  resultingSnapshotId: 'snap-result',
}

vi.mock('@/engine/snapshot-engine', () => ({
  listSnapshots: vi.fn(async () => [mockSnapshot]),
  captureSnapshot: vi.fn(async () => ({
    ...mockSnapshot,
    snapshotId: 'snap-new',
    type: 'manual',
    sequenceNumber: 2,
  })),
  rollbackTo: vi.fn(async () => mockRollbackMetadata),
}))

const mockPublishSnapshot = vi.fn()
const mockPublishRollback = vi.fn()
vi.mock('@/services/collab-publisher', () => ({
  publishSnapshot: (...args: any[]) => mockPublishSnapshot(...args),
  publishRollback: (...args: any[]) => mockPublishRollback(...args),
}))

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const mockLoadElements = vi.fn(async () => {})
const mockLoadChat = vi.fn(async () => {})
const mockLoadThreads = vi.fn(async () => {})

vi.mock('@/stores/element-store', () => ({
  useElementStore: () => ({ loadElements: mockLoadElements }),
}))
vi.mock('@/stores/chat-store', () => ({
  useChatStore: () => ({ loadChat: mockLoadChat }),
}))
vi.mock('@/stores/comment-store', () => ({
  useCommentStore: () => ({ loadThreads: mockLoadThreads }),
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({ activeProfileId: 'member-1' }),
}))

let membershipGateResult: { valid: boolean; errors: any[] } = { valid: true, errors: [] }
vi.mock('@/services/membership-gate', () => ({
  ensureActiveMembership: vi.fn(async () => membershipGateResult),
}))

const actor = { memberId: 'member-1', displayName: 'Alice', role: RoomRole.Host }

describe('snapshot-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockLoadElements.mockReset()
    mockLoadChat.mockReset()
    mockLoadThreads.mockReset()
    mockLoadElements.mockResolvedValue(undefined)
    mockLoadChat.mockResolvedValue(undefined)
    mockLoadThreads.mockResolvedValue(undefined)
    membershipGateResult = { valid: true, errors: [] }
  })

  describe('refresh', () => {
    it('loads snapshots on happy path', async () => {
      const store = useSnapshotStore()
      await store.refresh('room-1')
      expect(store.snapshots).toHaveLength(1)
      expect(store.isLoading).toBe(false)
      expect(store.lastError).toBeNull()
    })

    it('sets lastError on failure', async () => {
      const snapshotEngine = await import('@/engine/snapshot-engine')
      vi.mocked(snapshotEngine.listSnapshots).mockRejectedValueOnce(new Error('DB'))
      const store = useSnapshotStore()
      await store.refresh('room-1')
      expect(store.lastError).toBe('Failed to load snapshots.')
    })
  })

  describe('captureManual', () => {
    it('appends new snapshot to list', async () => {
      const store = useSnapshotStore()
      const snap = await store.captureManual('room-1')
      expect(snap).not.toBeNull()
      expect(snap?.snapshotId).toBe('snap-new')
      expect(store.snapshots).toHaveLength(1)
    })

    it('returns null and sets error on failure', async () => {
      const snapshotEngine = await import('@/engine/snapshot-engine')
      vi.mocked(snapshotEngine.captureSnapshot).mockRejectedValueOnce(new Error('DB'))
      const store = useSnapshotStore()
      const result = await store.captureManual('room-1')
      expect(result).toBeNull()
      expect(store.lastError).toBe('Failed to capture snapshot.')
    })
  })

  describe('rollback', () => {
    it('returns null without calling engine when confirm is rejected', async () => {
      const { useUiStore } = await import('@/stores/ui-store')
      const uiStore = useUiStore()
      vi.spyOn(uiStore, 'confirm').mockResolvedValueOnce(false)
      const store = useSnapshotStore()
      const result = await store.rollback('room-1', 'snap-1', actor)
      expect(result).toBeNull()
      const snapshotEngine = await import('@/engine/snapshot-engine')
      expect(snapshotEngine.rollbackTo).not.toHaveBeenCalled()
    })

    it('calls engine and refreshes snapshots when confirmed', async () => {
      const { useUiStore } = await import('@/stores/ui-store')
      const uiStore = useUiStore()
      vi.spyOn(uiStore, 'confirm').mockResolvedValueOnce(true)
      const store = useSnapshotStore()
      const result = await store.rollback('room-1', 'snap-1', actor)
      expect(result).toEqual(mockRollbackMetadata)
      expect(store.lastRollback).toEqual(mockRollbackMetadata)
      expect(store.isRollingBack).toBe(false)
    })

    it('reloads element, chat, and comment stores after successful rollback', async () => {
      const { useUiStore } = await import('@/stores/ui-store')
      const uiStore = useUiStore()
      vi.spyOn(uiStore, 'confirm').mockResolvedValueOnce(true)
      const store = useSnapshotStore()
      await store.rollback('room-1', 'snap-1', actor)
      expect(mockLoadElements).toHaveBeenCalledWith('room-1')
      expect(mockLoadChat).toHaveBeenCalledWith('room-1')
      expect(mockLoadThreads).toHaveBeenCalledWith('room-1')
    })

    it('sets isRollingBack false even on engine failure', async () => {
      const { useUiStore } = await import('@/stores/ui-store')
      const uiStore = useUiStore()
      vi.spyOn(uiStore, 'confirm').mockResolvedValueOnce(true)
      const snapshotEngine = await import('@/engine/snapshot-engine')
      vi.mocked(snapshotEngine.rollbackTo).mockRejectedValueOnce(new Error('Rollback failed'))
      const store = useSnapshotStore()
      const result = await store.rollback('room-1', 'snap-1', actor)
      expect(result).toBeNull()
      expect(store.isRollingBack).toBe(false)
      expect(store.lastError).toBe('Rollback failed. Please try again.')
    })
  })

  describe('membership gate enforcement', () => {
    const blocked = {
      valid: false,
      errors: [{ field: 'membershipState', message: 'Non-active member.', code: 'invalid_transition' }],
    }

    it('blocks captureManual for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useSnapshotStore()
      const result = await store.captureManual('room-1')
      expect(result).toBeNull()
      const snapshotEngine = await import('@/engine/snapshot-engine')
      expect(snapshotEngine.captureSnapshot).not.toHaveBeenCalled()
      expect(mockPublishSnapshot).not.toHaveBeenCalled()
    })

    it('blocks rollback for non-Active members without prompting confirm', async () => {
      membershipGateResult = blocked
      const { useUiStore } = await import('@/stores/ui-store')
      const uiStore = useUiStore()
      const confirmSpy = vi.spyOn(uiStore, 'confirm')
      const store = useSnapshotStore()
      const result = await store.rollback('room-1', 'snap-1', actor)
      expect(result).toBeNull()
      expect(confirmSpy).not.toHaveBeenCalled()
      const snapshotEngine = await import('@/engine/snapshot-engine')
      expect(snapshotEngine.rollbackTo).not.toHaveBeenCalled()
      expect(mockPublishRollback).not.toHaveBeenCalled()
    })
  })

  describe('collab-publisher integration', () => {
    it('publishes snapshot-created after captureManual succeeds', async () => {
      const store = useSnapshotStore()
      await store.captureManual('room-1')
      expect(mockPublishSnapshot).toHaveBeenCalledOnce()
      const [roomId, snapshotId, seq] = mockPublishSnapshot.mock.calls[0]
      expect(roomId).toBe('room-1')
      expect(snapshotId).toBe('snap-new')
      expect(seq).toBe(2)
    })

    it('does not publish snapshot-created when capture fails', async () => {
      const snapshotEngine = await import('@/engine/snapshot-engine')
      vi.mocked(snapshotEngine.captureSnapshot).mockRejectedValueOnce(new Error('DB'))
      const store = useSnapshotStore()
      await store.captureManual('room-1')
      expect(mockPublishSnapshot).not.toHaveBeenCalled()
    })

    it('publishes rollback-applied after successful rollback', async () => {
      const { useUiStore } = await import('@/stores/ui-store')
      const uiStore = useUiStore()
      vi.spyOn(uiStore, 'confirm').mockResolvedValueOnce(true)
      const store = useSnapshotStore()
      await store.rollback('room-1', 'snap-1', actor)
      expect(mockPublishRollback).toHaveBeenCalledOnce()
      const [roomId, snapshotId, initiator, resultingId] = mockPublishRollback.mock.calls[0]
      expect(roomId).toBe('room-1')
      expect(snapshotId).toBe('snap-1')
      expect(initiator).toBe(actor.memberId)
      expect(resultingId).toBe('snap-result')
    })
  })
})
