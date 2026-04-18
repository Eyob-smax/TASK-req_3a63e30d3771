// REQ: R8 — ChatPanel: send message, pin/unpin, pin cap, retention notice

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { RoomRole, MembershipState } from '@/models/room'
import { MAX_PINNED_MESSAGES, MAX_CHAT_MESSAGES_RETAINED } from '@/models/constants'

vi.mock('@/components/LimitIndicator.vue', () => ({
  default: { template: '<div class="limit-indicator" />', props: ['current', 'max', 'label'] },
}))
vi.mock('@/components/CounterChip.vue', () => ({
  default: { template: '<div />', props: ['count', 'max', 'label'] },
}))

const mockSendMessage = vi.fn(async () => ({
  validation: { valid: true, errors: [] },
  message: { messageId: 'new-msg', authorId: 'member-1' } as any,
}))
const mockPinMessage = vi.fn(async () => ({ validation: { valid: true, errors: [] }, pinned: null }))
const mockUnpinMessage = vi.fn(async () => ({ valid: true, errors: [] }))

const TEST_ACTOR = { memberId: 'member-1', displayName: 'Alice' }

const makeMessage = (id: string, isPinned = false) => ({
  messageId: id,
  roomId: 'room-1',
  authorId: 'member-1',
  authorDisplayName: 'Alice',
  authorAvatarColor: '#ff0000',
  text: `Message ${id}`,
  sentAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  isPinned,
  isDeleted: false,
})

const makePinned = (messageId: string) => ({
  pinnedId: `pin-${messageId}`,
  messageId,
  roomId: 'room-1',
  pinnedBy: 'member-1',
  pinnedByName: 'Alice',
  pinnedAt: '2026-01-01T00:00:00.000Z',
})

vi.mock('@/stores/chat-store', () => ({
  useChatStore: vi.fn(() => ({
    messages: [makeMessage('msg-1')],
    pinned: [],
    isLoading: false,
    lastError: null,
    loadChat: vi.fn(async () => {}),
    sendMessage: mockSendMessage,
    pinMessage: mockPinMessage,
    unpinMessage: mockUnpinMessage,
  })),
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({
    activeProfileId: 'member-1',
    activeProfile: { profileId: 'member-1', displayName: 'Alice', avatarColor: '#ff0000' },
  }),
}))

vi.mock('@/stores/room-store', () => ({
  useRoomStore: () => ({
    members: [
      {
        memberId: 'member-1',
        roomId: 'room-1',
        displayName: 'Alice',
        role: RoomRole.Reviewer,
        state: MembershipState.Active,
        avatarColor: '#ff0000',
        joinedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }),
}))

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

async function mountPanel(propsData = {}) {
  const { default: ChatPanel } = await import('@/components/workspace/ChatPanel.vue')
  return mount(ChatPanel, {
    props: { roomId: 'room-1', actor: TEST_ACTOR, disabled: false, ...propsData },
    attachTo: document.body,
  })
}

describe('ChatPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders message list', async () => {
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('Message msg-1')
  })

  it('sends message on submit', async () => {
    const wrapper = await mountPanel()
    const textarea = wrapper.find('textarea')
    await textarea.setValue('Hello there')
    await wrapper.find('[data-testid="send-btn"]').trigger('click')
    await flushPromises()
    expect(mockSendMessage).toHaveBeenCalledOnce()
    const call = mockSendMessage.mock.calls[0][0] as any
    expect(call.text).toBe('Hello there')
  })

  it('sendMessage call includes actor.memberId as authorId', async () => {
    const wrapper = await mountPanel()
    const textarea = wrapper.find('textarea')
    await textarea.setValue('ping')
    await wrapper.find('[data-testid="send-btn"]').trigger('click')
    await flushPromises()
    const call = mockSendMessage.mock.calls[0][0] as any
    expect(call.authorId).toBe(TEST_ACTOR.memberId)
    expect(call.authorDisplayName).toBe(TEST_ACTOR.displayName)
  })

  it('does not send empty message', async () => {
    const wrapper = await mountPanel()
    await wrapper.find('[data-testid="send-btn"]').trigger('click')
    await flushPromises()
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('disables composer when disabled prop is true', async () => {
    const wrapper = await mountPanel({ disabled: true })
    const textarea = wrapper.find('textarea')
    expect((textarea.element as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('shows pin button for reviewer role', async () => {
    const { useChatStore } = await import('@/stores/chat-store')
    vi.mocked(useChatStore).mockReturnValueOnce({
      messages: [makeMessage('msg-1')],
      pinned: [],
      isLoading: false,
      lastError: null,
      loadChat: vi.fn(async () => {}),
      sendMessage: mockSendMessage,
      pinMessage: mockPinMessage,
      unpinMessage: mockUnpinMessage,
    } as any)
    const wrapper = await mountPanel()
    expect(wrapper.find('[data-testid="pin-btn-msg-1"]').exists()).toBe(true)
  })

  it('pin button disabled at MAX_PINNED_MESSAGES cap', async () => {
    const pinnedList = Array.from({ length: MAX_PINNED_MESSAGES }, (_, i) => makePinned(`msg-${i}`))
    const { useChatStore } = await import('@/stores/chat-store')
    vi.mocked(useChatStore).mockReturnValueOnce({
      messages: [makeMessage('msg-1')],
      pinned: pinnedList,
      isLoading: false,
      lastError: null,
      loadChat: vi.fn(async () => {}),
      sendMessage: mockSendMessage,
      pinMessage: mockPinMessage,
      unpinMessage: mockUnpinMessage,
    } as any)
    const wrapper = await mountPanel()
    const pinBtn = wrapper.find('[data-testid="pin-btn-msg-1"]')
    if (pinBtn.exists()) {
      expect((pinBtn.element as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('shows retention notice when approaching message cap', async () => {
    const manyMessages = Array.from({ length: MAX_CHAT_MESSAGES_RETAINED - 50 }, (_, i) =>
      makeMessage(`msg-${i}`)
    )
    const { useChatStore } = await import('@/stores/chat-store')
    vi.mocked(useChatStore).mockReturnValueOnce({
      messages: manyMessages,
      pinned: [],
      isLoading: false,
      lastError: null,
      loadChat: vi.fn(async () => {}),
      sendMessage: mockSendMessage,
      pinMessage: mockPinMessage,
      unpinMessage: mockUnpinMessage,
    } as any)
    const wrapper = await mountPanel()
    expect(wrapper.text()).toMatch(/retention|limit|maximum|approaching/i)
  })

  it('renders empty state content when there are no messages', async () => {
    const { useChatStore } = await import('@/stores/chat-store')
    vi.mocked(useChatStore).mockReturnValueOnce({
      messages: [],
      pinned: [],
      isLoading: false,
      lastError: null,
      loadChat: vi.fn(async () => {}),
      sendMessage: mockSendMessage,
      pinMessage: mockPinMessage,
      unpinMessage: mockUnpinMessage,
    } as any)
    const wrapper = await mountPanel()
    expect(wrapper.text().toLowerCase()).toMatch(/no\s+messages|start|first/i)
  })

  it('pins a message when pin button is clicked', async () => {
    const wrapper = await mountPanel()
    const pinBtn = wrapper.find('[data-testid="pin-btn-msg-1"]')
    expect(pinBtn.exists()).toBe(true)

    await pinBtn.trigger('click')
    await flushPromises()

    expect(mockPinMessage).toHaveBeenCalledWith('room-1', 'msg-1', TEST_ACTOR)
  })

  it('unpinned row action calls unpinMessage', async () => {
    const { useChatStore } = await import('@/stores/chat-store')
    vi.mocked(useChatStore).mockReturnValueOnce({
      messages: [makeMessage('msg-1', true)],
      pinned: [makePinned('msg-1')],
      isLoading: false,
      lastError: null,
      loadChat: vi.fn(async () => {}),
      sendMessage: mockSendMessage,
      pinMessage: mockPinMessage,
      unpinMessage: mockUnpinMessage,
    } as any)

    const wrapper = await mountPanel()
    const unpinBtn = wrapper.find('.chat-panel__unpin-btn')
    expect(unpinBtn.exists()).toBe(true)

    await unpinBtn.trigger('click')
    await flushPromises()

    expect(mockUnpinMessage).toHaveBeenCalledWith('room-1', 'msg-1', TEST_ACTOR)
  })

  it('pressing Enter (without Shift) sends a message', async () => {
    const wrapper = await mountPanel()
    const textarea = wrapper.find('textarea')

    await textarea.setValue('Sent by Enter')
    await textarea.trigger('keydown', {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
    })
    await flushPromises()

    expect(mockSendMessage).toHaveBeenCalled()
  })
})
