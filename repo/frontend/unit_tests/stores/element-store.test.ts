// REQ: R5/R6 — Element store: createSticky, createArrow, createPenStroke, ingestImage, updateElement, deleteElement, bringToFront
// REQ: R18/R19 — element-store publishes BroadcastChannel + WebRTC messages on successful writes via collab-publisher

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useElementStore } from '@/stores/element-store'
import { ElementType } from '@/models/element'
import { RoomRole } from '@/models/room'

const mockSticky = {
  elementId: 'el-1',
  roomId: 'room-1',
  type: ElementType.StickyNote,
  position: { x: 100, y: 100 },
  size: { width: 200, height: 150 },
  text: 'Hello',
  color: '#fff9c4',
  zIndex: 1,
  createdBy: 'member-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isDeleted: false,
}

vi.mock('@/engine/element-engine', () => ({
  listElements: vi.fn(async () => [mockSticky]),
  createSticky: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    element: { ...mockSticky, elementId: 'sticky-new' },
  })),
  createArrow: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    element: { ...mockSticky, elementId: 'arrow-new', type: 'arrow' },
  })),
  createPenStroke: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    element: { ...mockSticky, elementId: 'pen-new', type: 'pen-stroke' },
  })),
  updateElement: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    element: { ...mockSticky, text: 'Updated' },
  })),
  deleteElement: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
  })),
  bringToFront: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    element: { ...mockSticky, zIndex: 10 },
  })),
}))

vi.mock('@/engine/image-engine', () => ({
  ingestImageFile: vi.fn(async () => ({
    validation: { valid: true, errors: [] },
    element: { ...mockSticky, elementId: 'img-new', type: 'image' },
  })),
}))

const mockPublishElement = vi.fn()
const mockPublishConflict = vi.fn()
vi.mock('@/services/collab-publisher', () => ({
  publishElement: (...args: any[]) => mockPublishElement(...args),
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

const actor = { memberId: 'member-1', displayName: 'Alice', role: RoomRole.Participant }

describe('element-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    membershipGateResult = { valid: true, errors: [] }
  })

  describe('loadElements', () => {
    it('loads elements on happy path', async () => {
      const store = useElementStore()
      await store.loadElements('room-1')
      expect(store.elements).toHaveLength(1)
      expect(store.isLoading).toBe(false)
      expect(store.lastError).toBeNull()
    })

    it('sets lastError on failure', async () => {
      const elementEngine = await import('@/engine/element-engine')
      vi.mocked(elementEngine.listElements).mockRejectedValueOnce(new Error('DB error'))
      const store = useElementStore()
      await store.loadElements('room-1')
      expect(store.lastError).toBe('Failed to load elements.')
      expect(store.elements).toHaveLength(0)
    })
  })

  describe('createSticky', () => {
    it('adds element to list on success', async () => {
      const store = useElementStore()
      const result = await store.createSticky({
        roomId: 'room-1',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 150 },
        text: 'Hello',
        color: '#fff9c4',
        actor,
      })
      expect(result.validation.valid).toBe(true)
      expect(store.elements).toHaveLength(1)
      expect(store.elements[0].elementId).toBe('sticky-new')
    })

    it('publishes element-change with op "create" via collab-publisher', async () => {
      const store = useElementStore()
      await store.createSticky({
        roomId: 'room-1',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 150 },
        text: 'Hello',
        color: '#fff9c4',
        actor,
      })
      expect(mockPublishElement).toHaveBeenCalledOnce()
      const [roomId, op, elementId] = mockPublishElement.mock.calls[0]
      expect(roomId).toBe('room-1')
      expect(op).toBe('create')
      expect(elementId).toBe('sticky-new')
    })
  })

  describe('createArrow', () => {
    it('adds arrow element to list', async () => {
      const store = useElementStore()
      const result = await store.createArrow({
        roomId: 'room-1',
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 100, y: 100 },
        actor,
      })
      expect(result.validation.valid).toBe(true)
      expect(store.elements[0].elementId).toBe('arrow-new')
    })
  })

  describe('createPenStroke', () => {
    it('adds pen stroke element to list', async () => {
      const store = useElementStore()
      const result = await store.createPenStroke({
        roomId: 'room-1',
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
        color: '#000',
        strokeWidth: 2,
        actor,
      })
      expect(result.validation.valid).toBe(true)
      expect(store.elements[0].elementId).toBe('pen-new')
    })
  })

  describe('ingestImage', () => {
    it('adds image element to list', async () => {
      const store = useElementStore()
      const fakeBlob = new Blob(['data'], { type: 'image/png' })
      const result = await store.ingestImage({
        roomId: 'room-1',
        blob: fakeBlob,
        fileName: 'test.png',
        mimeType: 'image/png',
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 80 },
        actor,
      })
      expect(result.validation.valid).toBe(true)
      expect(store.elements[0].elementId).toBe('img-new')
    })
  })

  describe('updateElement', () => {
    it('updates element in list on success', async () => {
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      const result = await store.updateElement('el-1', { text: 'Updated' }, actor)
      expect(result.validation.valid).toBe(true)
      expect((store.elements[0] as any).text).toBe('Updated')
    })

    it('publishes element-change with op "update"', async () => {
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      await store.updateElement('el-1', { text: 'Updated' }, actor)
      expect(mockPublishElement).toHaveBeenCalled()
      const call = mockPublishElement.mock.calls.find((c) => c[1] === 'update')
      expect(call).toBeDefined()
    })
  })

  describe('deleteElement', () => {
    it('removes element from list on success', async () => {
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      await store.deleteElement('el-1', actor)
      expect(store.elements).toHaveLength(0)
    })

    it('publishes element-change with op "delete"', async () => {
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      await store.deleteElement('el-1', actor)
      expect(mockPublishElement).toHaveBeenCalled()
      const call = mockPublishElement.mock.calls.find((c) => c[1] === 'delete')
      expect(call).toBeDefined()
      expect(call?.[2]).toBe('el-1')
    })
  })

  describe('bringToFront', () => {
    it('updates element zIndex in list', async () => {
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      const result = await store.bringToFront('el-1', actor)
      expect(result.validation.valid).toBe(true)
      expect((store.elements[0] as any).zIndex).toBe(10)
    })
  })

  describe('conflict publication', () => {
    it('publishes element-overwrite conflict when updateElement targets an element that already disappeared', async () => {
      const elementEngine = await import('@/engine/element-engine')
      vi.mocked(elementEngine.updateElement).mockResolvedValueOnce({
        validation: {
          valid: false,
          errors: [
            {
              field: 'elementId',
              message: 'Element no longer exists.',
              code: 'not_found',
              value: 'el-1',
            },
          ],
        },
      } as any)
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      await store.updateElement('el-1', { text: 'x' } as any, actor)
      expect(mockPublishConflict).toHaveBeenCalledOnce()
      const [roomId, type, resourceId, tabId] = mockPublishConflict.mock.calls[0]
      expect(roomId).toBe('room-1')
      expect(type).toBe('element-overwrite')
      expect(resourceId).toBe('el-1')
      expect(tabId).toBe('tab-test')
    })

    it('does not publish conflict when update succeeds', async () => {
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      await store.updateElement('el-1', { text: 'Updated' } as any, actor)
      expect(mockPublishConflict).not.toHaveBeenCalled()
    })
  })

  describe('membership gate enforcement', () => {
    const blocked = {
      valid: false,
      errors: [{ field: 'membershipState', message: 'Non-active member.', code: 'invalid_transition' }],
    }

    it('blocks createSticky for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useElementStore()
      const result = await store.createSticky({
        roomId: 'room-1',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 150 },
        text: 'Hello',
        color: '#fff9c4',
        actor,
      } as any)
      expect(result.validation.valid).toBe(false)
      const elementEngine = await import('@/engine/element-engine')
      expect(elementEngine.createSticky).not.toHaveBeenCalled()
      expect(mockPublishElement).not.toHaveBeenCalled()
    })

    it('blocks createArrow for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useElementStore()
      const result = await store.createArrow({
        roomId: 'room-1',
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 100, y: 100 },
        actor,
      } as any)
      expect(result.validation.valid).toBe(false)
      const elementEngine = await import('@/engine/element-engine')
      expect(elementEngine.createArrow).not.toHaveBeenCalled()
    })

    it('blocks createPenStroke for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useElementStore()
      const result = await store.createPenStroke({
        roomId: 'room-1',
        points: [{ x: 0, y: 0 }],
        color: '#000',
        strokeWidth: 1,
        actor,
      } as any)
      expect(result.validation.valid).toBe(false)
      const elementEngine = await import('@/engine/element-engine')
      expect(elementEngine.createPenStroke).not.toHaveBeenCalled()
    })

    it('blocks updateElement for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      const result = await store.updateElement('el-1', { text: 'x' } as any, actor)
      expect(result.validation.valid).toBe(false)
      const elementEngine = await import('@/engine/element-engine')
      expect(elementEngine.updateElement).not.toHaveBeenCalled()
    })

    it('blocks deleteElement for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      const result = await store.deleteElement('el-1', actor)
      expect(result.validation.valid).toBe(false)
      expect(store.elements).toHaveLength(1)
      const elementEngine = await import('@/engine/element-engine')
      expect(elementEngine.deleteElement).not.toHaveBeenCalled()
    })

    it('blocks bringToFront for non-Active members', async () => {
      membershipGateResult = blocked
      const store = useElementStore()
      store.elements = [{ ...mockSticky }] as any
      const result = await store.bringToFront('el-1', actor)
      expect(result.validation.valid).toBe(false)
      const elementEngine = await import('@/engine/element-engine')
      expect(elementEngine.bringToFront).not.toHaveBeenCalled()
    })
  })
})
