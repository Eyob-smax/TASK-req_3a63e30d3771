// REQ: R5/R6/R9 — CanvasHost: tool selection, sticky modal, image drop >5MB rejected,
// element cap banner, open-comments emit, cursor-move emit

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ElementType } from '@/models/element'
import { MAX_ELEMENTS_PER_ROOM, MAX_IMAGE_SIZE_BYTES } from '@/models/constants'

vi.mock('@/components/LimitIndicator.vue', () => ({
  default: { template: '<div class="limit-indicator">{{ label }}</div>', props: ['current', 'max', 'label'] },
}))

const TEST_ACTOR = { memberId: 'member-1', displayName: 'Alice' }

const mockCreateSticky = vi.fn(async () => ({
  validation: { valid: true, errors: [] },
  element: { elementId: 'el-new', type: ElementType.StickyNote },
}))
const mockCreateArrow = vi.fn(async () => ({
  validation: { valid: true, errors: [] },
  element: { elementId: 'arrow-new', type: ElementType.Arrow },
}))
const mockCreatePenStroke = vi.fn(async () => ({
  validation: { valid: true, errors: [] },
  element: { elementId: 'pen-new', type: ElementType.PenStroke },
}))
const mockIngestImage = vi.fn(async () => ({
  validation: { valid: true, errors: [] },
  element: { elementId: 'img-new', type: 'image' },
}))
const mockDeleteElement = vi.fn(async () => ({ validation: { valid: true, errors: [] } }))
const mockBringToFront = vi.fn(async () => ({ validation: { valid: true, errors: [] } }))

const mockUiToastError = vi.fn()
const mockUiToastWarning = vi.fn()
const mockGetImageById = vi.fn(async () => undefined)

vi.mock('@/stores/element-store', () => ({
  useElementStore: vi.fn(() => ({
    elements: [],
    isLoading: false,
    createSticky: mockCreateSticky,
    createArrow: mockCreateArrow,
    createPenStroke: mockCreatePenStroke,
    ingestImage: mockIngestImage,
    updateElement: vi.fn(async () => ({ validation: { valid: true, errors: [] }, element: null })),
    deleteElement: mockDeleteElement,
    bringToFront: mockBringToFront,
  })),
}))

vi.mock('@/stores/room-store', () => ({
  useRoomStore: () => ({
    activeRoom: { roomId: 'room-1', name: 'Test' },
    members: [{ memberId: 'member-1', displayName: 'Alice', role: 'host', state: 'active' }],
    activeMembers: [{ memberId: 'member-1' }],
  }),
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({
    activeProfileId: 'member-1',
    activeProfile: { profileId: 'member-1', displayName: 'Alice', avatarColor: '#ff0000' },
  }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUiStore: () => ({
    toast: { error: mockUiToastError, warning: mockUiToastWarning, success: vi.fn() },
  }),
}))

vi.mock('@/stores/comment-store', () => ({
  useCommentStore: () => ({
    threads: [],
    commentsByThread: {},
    loadThreads: vi.fn(async () => {}),
  }),
}))

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/services/image-blob-repository', () => ({
  imageBlobRepository: {
    getById: (...args: any[]) => mockGetImageById(...args),
  },
}))

async function mountCanvas(propsData = {}) {
  const { default: CanvasHost } = await import('@/components/workspace/CanvasHost.vue')
  return mount(CanvasHost, {
    props: {
      roomId: 'room-1',
      activeTool: 'select',
      actor: TEST_ACTOR,
      disabled: false,
      ...propsData,
    },
    attachTo: document.body,
  })
}

describe('CanvasHost', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(globalThis as any).URL = {
      createObjectURL: vi.fn(() => 'blob:mock-image-url'),
      revokeObjectURL: vi.fn(),
    }
  })

  it('renders canvas root', async () => {
    const wrapper = await mountCanvas()
    expect(wrapper.find('.canvas-host').exists()).toBe(true)
  })

  it('double-click opens sticky note editor in sticky mode', async () => {
    const wrapper = await mountCanvas({ activeTool: 'sticky' })
    const host = wrapper.find('.canvas-host')
    await host.trigger('dblclick', { clientX: 100, clientY: 100 })
    await flushPromises()
    expect(wrapper.find('.canvas-host__sticky-editor').exists()).toBe(true)
  })

  it('confirms sticky editor and creates sticky note', async () => {
    const wrapper = await mountCanvas({ activeTool: 'sticky' })
    const host = wrapper.find('.canvas-host')
    await host.trigger('dblclick', { clientX: 80, clientY: 60 })
    await flushPromises()

    await wrapper.find('.canvas-host__sticky-textarea').setValue('Draft note')
    await wrapper.find('.canvas-host__sticky-confirm').trigger('click')
    await flushPromises()

    expect(mockCreateSticky).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('tool-used')).toBeTruthy()
    expect(wrapper.find('.canvas-host__sticky-editor').exists()).toBe(false)
  })

  it('shows disabled overlay when disabled prop is true', async () => {
    const wrapper = await mountCanvas({ disabled: true })
    expect(wrapper.find('.canvas-host__disabled-overlay').exists()).toBe(true)
  })

  it('shows cap banner when at element limit', async () => {
    const { useElementStore } = await import('@/stores/element-store')
    const maxElements = Array.from({ length: MAX_ELEMENTS_PER_ROOM }, (_, i) => ({
      elementId: `el-${i}`,
      roomId: 'room-1',
      type: ElementType.StickyNote,
      position: { x: 10, y: 10 },
      dimensions: { width: 100, height: 60 },
      text: `sticky-${i}`,
      backgroundColor: '#fef9c3',
      textColor: '#1e293b',
      fontSize: 14,
      zIndex: i,
    }))
    vi.mocked(useElementStore).mockReturnValueOnce({
      elements: maxElements,
      isLoading: false,
      createSticky: mockCreateSticky,
      createArrow: vi.fn(),
      createPenStroke: vi.fn(),
      ingestImage: mockIngestImage,
      updateElement: vi.fn(),
      deleteElement: mockDeleteElement,
      bringToFront: vi.fn(),
    } as any)
    const wrapper = await mountCanvas()
    const hasCapIndicator =
      wrapper.find('.canvas-host__cap-banner').exists() ||
      wrapper.find('.limit-indicator').exists()
    expect(hasCapIndicator).toBe(true)
  })

  it('rejects image file larger than MAX_IMAGE_SIZE_BYTES on drop', async () => {
    const wrapper = await mountCanvas({ activeTool: 'image' })
    const host = wrapper.find('.canvas-host')
    const largeFile = new File([new ArrayBuffer(8)], 'big.png', { type: 'image/png' })
    Object.defineProperty(largeFile, 'size', { value: MAX_IMAGE_SIZE_BYTES + 1 })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [largeFile], types: ['Files'] },
    })
    host.element.dispatchEvent(dropEvent)
    await flushPromises()
    expect(mockIngestImage).not.toHaveBeenCalled()
    expect(mockUiToastError).toHaveBeenCalled()
  })

  it('ingestImage receives {blob, fileName, mimeType, dimensions} shape on valid drop', async () => {
    // Stub createImageBitmap to return a synchronous-friendly bitmap
    ;(globalThis as any).createImageBitmap = vi.fn(async () => ({
      width: 120,
      height: 80,
      close: vi.fn(),
    }))

    const wrapper = await mountCanvas({ activeTool: 'image' })
    const host = wrapper.find('.canvas-host')
    const smallFile = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })
    Object.defineProperty(smallFile, 'size', { value: 3 })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [smallFile], types: ['Files'] },
    })
    host.element.dispatchEvent(dropEvent)
    await flushPromises()
    expect(mockIngestImage).toHaveBeenCalledOnce()
    const call = mockIngestImage.mock.calls[0][0] as any
    expect(call.blob).toBe(smallFile)
    expect(call.fileName).toBe('pic.png')
    expect(call.mimeType).toBe('image/png')
    expect(call.dimensions).toBeDefined()
    expect(call).not.toHaveProperty('file')
  })

  it('emits open-comments when the Comment action button is clicked while an element is selected', async () => {
    const stickyEl = {
      elementId: 'el-s1',
      roomId: 'room-1',
      type: ElementType.StickyNote,
      position: { x: 20, y: 20 },
      dimensions: { width: 100, height: 60 },
      backgroundColor: '#fef9c3',
      textColor: '#1e293b',
      fontSize: 14,
      text: 'Hi',
      zIndex: 1,
    }
    const { useElementStore } = await import('@/stores/element-store')
    vi.mocked(useElementStore).mockReturnValueOnce({
      elements: [stickyEl],
      isLoading: false,
      createSticky: mockCreateSticky,
      createArrow: vi.fn(),
      createPenStroke: vi.fn(),
      ingestImage: mockIngestImage,
      updateElement: vi.fn(),
      deleteElement: mockDeleteElement,
      bringToFront: vi.fn(),
    } as any)
    const wrapper = await mountCanvas({ activeTool: 'select' })
    await wrapper.find('.canvas-host__sticky').trigger('click')
    await flushPromises()
    const commentBtn = wrapper.find('[data-testid="canvas-comment-btn"]')
    expect(commentBtn.exists()).toBe(true)
    await commentBtn.trigger('click')
    await flushPromises()
    const events = wrapper.emitted('open-comments')
    expect(events).toBeTruthy()
    expect(events?.[0]).toEqual(['el-s1'])
  })

  it('emits cursor-move on pointer move', async () => {
    ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    }
    const wrapper = await mountCanvas({ activeTool: 'select' })
    const host = wrapper.find('.canvas-host')
    await host.trigger('pointermove', { clientX: 50, clientY: 25 })
    await flushPromises()
    expect(wrapper.emitted('cursor-move')).toBeTruthy()
  })

  it('creates an arrow on pointer sequence in arrow mode', async () => {
    const wrapper = await mountCanvas({ activeTool: 'arrow' })
    const host = wrapper.find('.canvas-host')

    await host.trigger('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 })
    await host.trigger('pointermove', { clientX: 40, clientY: 35, pointerId: 1 })
    await host.trigger('pointerup', { clientX: 40, clientY: 35, pointerId: 1 })
    await flushPromises()

    expect(mockCreateArrow).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('tool-used')).toBeTruthy()
  })

  it('creates a pen stroke on pointer sequence in pen mode', async () => {
    const wrapper = await mountCanvas({ activeTool: 'pen' })
    const host = wrapper.find('.canvas-host')

    await host.trigger('pointerdown', { clientX: 20, clientY: 20, pressure: 0.4, pointerId: 1 })
    await host.trigger('pointermove', { clientX: 25, clientY: 24, pressure: 0.6, pointerId: 1 })
    await host.trigger('pointermove', { clientX: 34, clientY: 28, pressure: 0.7, pointerId: 1 })
    await host.trigger('pointerup', { clientX: 34, clientY: 28, pressure: 0.7, pointerId: 1 })
    await flushPromises()

    expect(mockCreatePenStroke).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('tool-used')).toBeTruthy()
  })

  it('sets copy dropEffect on dragover for image tool', async () => {
    const wrapper = await mountCanvas({ activeTool: 'image' })
    const host = wrapper.find('.canvas-host')
    const dragEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    const dataTransfer = { dropEffect: 'none' }
    Object.defineProperty(dragEvent, 'dataTransfer', { value: dataTransfer })

    host.element.dispatchEvent(dragEvent)

    expect(dataTransfer.dropEffect).toBe('copy')
  })

  it('renders blob-backed image element when image blob exists', async () => {
    const imageEl = {
      elementId: 'el-img-1',
      roomId: 'room-1',
      type: ElementType.Image,
      imageId: 'img-1',
      position: { x: 10, y: 10 },
      dimensions: { width: 120, height: 80 },
      fileName: 'diagram.png',
      mimeType: 'image/png',
      fileSizeBytes: 3,
      alt: 'diagram',
      zIndex: 2,
    }
    mockGetImageById.mockResolvedValueOnce({
      imageId: 'img-1',
      roomId: 'room-1',
      elementId: 'el-img-1',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      fileName: 'diagram.png',
      mimeType: 'image/png',
      fileSizeBytes: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const { useElementStore } = await import('@/stores/element-store')
    vi.mocked(useElementStore).mockReturnValueOnce({
      elements: [imageEl],
      isLoading: false,
      createSticky: mockCreateSticky,
      createArrow: vi.fn(),
      createPenStroke: vi.fn(),
      ingestImage: mockIngestImage,
      updateElement: vi.fn(),
      deleteElement: mockDeleteElement,
      bringToFront: vi.fn(),
    } as any)

    const wrapper = await mountCanvas({ activeTool: 'select' })
    await flushPromises()
    expect(wrapper.find('.canvas-host__image').exists()).toBe(true)
    expect(wrapper.find('.canvas-host__image-placeholder').exists()).toBe(false)

    wrapper.unmount()
    expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('bring-to-front and delete actions call element store handlers', async () => {
    const stickyEl = {
      elementId: 'el-action',
      roomId: 'room-1',
      type: ElementType.StickyNote,
      position: { x: 20, y: 20 },
      dimensions: { width: 100, height: 60 },
      backgroundColor: '#fef9c3',
      textColor: '#1e293b',
      fontSize: 14,
      text: 'Action target',
      zIndex: 1,
    }
    const { useElementStore } = await import('@/stores/element-store')
    vi.mocked(useElementStore).mockReturnValueOnce({
      elements: [stickyEl],
      isLoading: false,
      createSticky: mockCreateSticky,
      createArrow: mockCreateArrow,
      createPenStroke: mockCreatePenStroke,
      ingestImage: mockIngestImage,
      updateElement: vi.fn(),
      deleteElement: mockDeleteElement,
      bringToFront: mockBringToFront,
    } as any)

    const wrapper = await mountCanvas({ activeTool: 'select' })
    await wrapper.find('.canvas-host__sticky').trigger('click')
    await flushPromises()

    const actionButtons = wrapper.findAll('.canvas-host__action-btn')
    await actionButtons[0].trigger('click')
    await actionButtons[1].trigger('click')
    await flushPromises()

    expect(mockBringToFront).toHaveBeenCalledWith('el-action', TEST_ACTOR)
    expect(mockDeleteElement).toHaveBeenCalledWith('el-action', TEST_ACTOR)
  })

  it('keyboard delete removes selected element and clears selection', async () => {
    const stickyEl = {
      elementId: 'el-kbd',
      roomId: 'room-1',
      type: ElementType.StickyNote,
      position: { x: 20, y: 20 },
      dimensions: { width: 100, height: 60 },
      backgroundColor: '#fef9c3',
      textColor: '#1e293b',
      fontSize: 14,
      text: 'Delete target',
      zIndex: 1,
    }
    const { useElementStore } = await import('@/stores/element-store')
    vi.mocked(useElementStore).mockReturnValueOnce({
      elements: [stickyEl],
      isLoading: false,
      createSticky: mockCreateSticky,
      createArrow: mockCreateArrow,
      createPenStroke: mockCreatePenStroke,
      ingestImage: mockIngestImage,
      updateElement: vi.fn(),
      deleteElement: mockDeleteElement,
      bringToFront: mockBringToFront,
    } as any)

    const wrapper = await mountCanvas({ activeTool: 'select' })
    await wrapper.find('.canvas-host__sticky').trigger('click')
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))
    await flushPromises()

    expect(mockDeleteElement).toHaveBeenCalledWith('el-kbd', TEST_ACTOR)
    const elementSelectedEvents = wrapper.emitted('element-selected') ?? []
    expect(elementSelectedEvents.some((entry) => entry[0] === null)).toBe(true)
  })
})
