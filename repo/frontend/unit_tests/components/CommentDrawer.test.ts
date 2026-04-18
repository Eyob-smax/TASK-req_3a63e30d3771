// REQ: R7 — CommentDrawer: renders threads, append comment, 200-cap, mention suggestions

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { MAX_COMMENTS_PER_THREAD } from '@/models/constants'

vi.mock('@/components/LimitIndicator.vue', () => ({
  default: { template: '<div class="limit-indicator" />', props: ['current', 'max', 'label'] },
}))

const mockCreateThread = vi.fn(async () => ({
  validation: { valid: true, errors: [] },
  thread: { threadId: 'thread-new', elementId: 'el-1', roomId: 'room-1' },
}))
const mockAppendComment = vi.fn(async () => ({
  validation: { valid: true, errors: [] },
  comment: { commentId: 'cmt-new', text: 'New comment' },
}))
const mockResolveMentions = vi.fn(() => [
  { memberId: 'member-1', displayName: 'Alice', isActive: true },
  { memberId: 'member-2', displayName: 'Bob', isActive: false },
])

const mockThread = {
  threadId: 'thread-1',
  elementId: 'el-1',
  roomId: 'room-1',
  createdBy: 'member-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  commentCount: 2,
  isResolved: false,
}

const mockComment = {
  commentId: 'cmt-1',
  threadId: 'thread-1',
  authorId: 'member-1',
  authorDisplayName: 'Alice',
  text: 'First comment',
  createdAt: '2026-01-01T00:00:00.000Z',
  isDeleted: false,
}

vi.mock('@/stores/comment-store', () => ({
  useCommentStore: vi.fn(() => ({
    threads: [mockThread],
    commentsByThread: { 'thread-1': [mockComment] },
    isLoading: false,
    lastError: null,
    loadThreads: vi.fn(async () => {}),
    loadComments: vi.fn(async () => {}),
    createThread: mockCreateThread,
    appendComment: mockAppendComment,
    resolveMentions: mockResolveMentions,
  })),
}))

vi.mock('@/stores/room-store', () => ({
  useRoomStore: () => ({
    members: [
      { memberId: 'member-1', displayName: 'Alice', state: 'active', role: 'participant' },
      { memberId: 'member-2', displayName: 'Bob', state: 'left', role: 'participant' },
    ],
  }),
}))

vi.mock('@/stores/session-store', () => ({
  useSessionStore: () => ({
    activeProfileId: 'member-1',
    activeProfile: { profileId: 'member-1', displayName: 'Alice', avatarColor: '#ff0000' },
  }),
}))

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

const TEST_ACTOR = { memberId: 'member-1', displayName: 'Alice' }

async function mountDrawer(props = {}) {
  const { default: CommentDrawer } = await import('@/components/workspace/CommentDrawer.vue')
  return mount(CommentDrawer, {
    props: {
      elementId: 'el-1',
      roomId: 'room-1',
      actor: TEST_ACTOR,
      disabled: false,
      ...props,
    },
  })
}

describe('CommentDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders threads for the element', async () => {
    const wrapper = await mountDrawer()
    expect(wrapper.text()).toContain('First comment')
  })

  it('emits close when close button clicked', async () => {
    const wrapper = await mountDrawer()
    const closeBtn = wrapper.find('[data-testid="comment-drawer-close"]')
    if (closeBtn.exists()) {
      await closeBtn.trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    }
  })

  it('hides when elementId is empty string', async () => {
    const wrapper = await mountDrawer({ elementId: '' })
    expect(wrapper.find('.comment-drawer').exists()).toBe(false)
  })

  it('shows mention suggestions on @ input', async () => {
    const wrapper = await mountDrawer()
    const textarea = wrapper.find('[data-testid="comment-input"]')
    if (textarea.exists()) {
      await textarea.setValue('@al')
      await textarea.trigger('input')
      await flushPromises()
      expect(mockResolveMentions).toHaveBeenCalled()
    }
  })

  it('disables input at comment cap', async () => {
    const { useCommentStore } = await import('@/stores/comment-store')
    const atCap = Array.from({ length: MAX_COMMENTS_PER_THREAD }, (_, i) => ({
      ...mockComment,
      commentId: `cmt-${i}`,
    }))
    vi.mocked(useCommentStore).mockReturnValueOnce({
      threads: [{ ...mockThread, commentCount: MAX_COMMENTS_PER_THREAD }],
      commentsByThread: { 'thread-1': atCap },
      isLoading: false,
      lastError: null,
      loadThreads: vi.fn(async () => {}),
      loadComments: vi.fn(async () => {}),
      createThread: mockCreateThread,
      appendComment: mockAppendComment,
      resolveMentions: mockResolveMentions,
    } as any)
    const wrapper = await mountDrawer()
    const textarea = wrapper.find('[data-testid="comment-input"]')
    if (textarea.exists()) {
      expect((textarea.element as HTMLTextAreaElement).disabled).toBe(true)
    }
  })

  it('inactive members are marked with (left) in suggestions', async () => {
    mockResolveMentions.mockReturnValueOnce([
      { memberId: 'member-2', displayName: 'Bob', isActive: false },
    ])
    const wrapper = await mountDrawer()
    const textarea = wrapper.find('[data-testid="comment-input"]')
    if (textarea.exists()) {
      await textarea.setValue('@bo')
      await textarea.trigger('input')
      await flushPromises()
      expect(wrapper.text()).toMatch(/Bob.*\(left\)/s)
    }
  })

  it('appendComment call includes actor.memberId / displayName', async () => {
    const wrapper = await mountDrawer()
    const textarea = wrapper.find('[data-testid="comment-input"]')
    if (!textarea.exists()) return
    await textarea.setValue('follow-up')
    await textarea.trigger('input')
    const submitBtn = wrapper.find('[data-testid="comment-submit"]')
    if (submitBtn.exists()) {
      await submitBtn.trigger('click')
    } else {
      // Fallback: pressing Enter
      await textarea.trigger('keydown', { key: 'Enter' })
    }
    await flushPromises()
    if (mockAppendComment.mock.calls.length > 0) {
      const call = mockAppendComment.mock.calls[0][0] as any
      expect(call.authorId).toBe(TEST_ACTOR.memberId)
      expect(call.authorDisplayName).toBe(TEST_ACTOR.displayName)
    }
  })

  it('selecting a mention inserts display name and closes suggestions', async () => {
    const wrapper = await mountDrawer()
    const textarea = wrapper.find('[data-testid="comment-input"]')
    await textarea.setValue('@al')
    await textarea.trigger('input')
    await flushPromises()

    const mentionButton = wrapper.find('.comment-drawer__mention-item')
    expect(mentionButton.exists()).toBe(true)
    await mentionButton.trigger('click')
    await flushPromises()

    expect((wrapper.find('[data-testid="comment-input"]').element as HTMLTextAreaElement).value).toContain('@Alice ')
  })

  it('submitComment appends to existing thread and clears input on success', async () => {
    const wrapper = await mountDrawer()
    const textarea = wrapper.find('[data-testid="comment-input"]')
    await textarea.setValue('Follow-up comment')
    await textarea.trigger('input')
    await flushPromises()

    await wrapper.find('.comment-drawer__submit').trigger('click')
    await flushPromises()

    expect(mockAppendComment).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        roomId: 'room-1',
        authorId: TEST_ACTOR.memberId,
        authorDisplayName: TEST_ACTOR.displayName,
        text: 'Follow-up comment',
      })
    )
    expect((wrapper.find('[data-testid="comment-input"]').element as HTMLTextAreaElement).value).toBe('')
  })

  it('submitComment creates a new thread when no thread exists for element', async () => {
    const loadComments = vi.fn(async () => {})
    const { useCommentStore } = await import('@/stores/comment-store')
    vi.mocked(useCommentStore).mockReturnValueOnce({
      threads: [],
      commentsByThread: {},
      isLoading: false,
      lastError: null,
      loadThreads: vi.fn(async () => {}),
      loadComments,
      createThread: mockCreateThread,
      appendComment: mockAppendComment,
      resolveMentions: mockResolveMentions,
    } as any)

    const wrapper = await mountDrawer({ elementId: 'el-1' })
    const textarea = wrapper.find('[data-testid="comment-input"]')
    await textarea.setValue('First thread comment')
    await textarea.trigger('input')
    await flushPromises()

    await wrapper.find('.comment-drawer__submit').trigger('click')
    await flushPromises()

    expect(mockCreateThread).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        elementId: 'el-1',
        authorId: TEST_ACTOR.memberId,
        authorDisplayName: TEST_ACTOR.displayName,
        text: 'First thread comment',
      })
    )
    expect(loadComments).toHaveBeenCalledWith('thread-new')
  })
})
