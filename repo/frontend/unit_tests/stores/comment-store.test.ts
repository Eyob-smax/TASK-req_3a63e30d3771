// REQ: R7 — Thin comment store wrapping the comment engine

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { MembershipState, RoomRole } from '@/models/room'
import type { MemberRecord } from '@/models/room'
import type { CommentThread, Comment } from '@/models/comment'
import { validResult } from '@/models/validation'

const { listByRoomMock, getThreadByIdMock, engineMocks, loggerError } = vi.hoisted(() => ({
  listByRoomMock: vi.fn<any, Promise<CommentThread[]>>(),
  getThreadByIdMock: vi.fn<any, Promise<CommentThread | undefined>>(),
  engineMocks: {
    listComments: vi.fn<any, Promise<Comment[]>>(),
    createThread: vi.fn(),
    appendComment: vi.fn(),
    resolveMentions: vi.fn(),
  },
  loggerError: vi.fn(),
}))

vi.mock('@/services/comment-thread-repository', () => ({
  commentThreadRepository: {
    listByRoom: (...args: any[]) => listByRoomMock(...args),
    getById: (...args: any[]) => getThreadByIdMock(...args),
  },
}))

vi.mock('@/engine/comment-engine', () => engineMocks)

vi.mock('@/utils/logger', () => ({
  logger: { error: loggerError, info: vi.fn(), warn: vi.fn() },
}))

let membershipGateResult: { valid: boolean; errors: any[] } = { valid: true, errors: [] }
vi.mock('@/services/membership-gate', () => ({
  ensureActiveMembership: vi.fn(async () => membershipGateResult),
}))

import { useCommentStore } from '@/stores/comment-store'

function makeThread(id: string, roomId = 'r1'): CommentThread {
  return {
    threadId: id,
    roomId,
    elementId: `el-${id}`,
    commentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastCommentAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeComment(id: string, threadId: string, text = 'hi'): Comment {
  return {
    commentId: id,
    threadId,
    roomId: 'r1',
    authorId: 'a1',
    authorDisplayName: 'Alex',
    text,
    mentions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isEdited: false,
    isDeleted: false,
  }
}

describe('comment-store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    membershipGateResult = { valid: true, errors: [] }
  })

  it('loadThreads populates threads from the repository', async () => {
    listByRoomMock.mockResolvedValueOnce([makeThread('t1'), makeThread('t2')])
    const store = useCommentStore()
    await store.loadThreads('r1')
    expect(store.threads.length).toBe(2)
    expect(store.isLoading).toBe(false)
    expect(store.lastError).toBeNull()
  })

  it('loadThreads sets lastError when the repository rejects', async () => {
    listByRoomMock.mockRejectedValueOnce(new Error('boom'))
    const store = useCommentStore()
    await store.loadThreads('r1')
    expect(store.lastError).toBe('Failed to load comment threads.')
    expect(loggerError).toHaveBeenCalled()
  })

  it('loadComments caches comments by threadId', async () => {
    engineMocks.listComments.mockResolvedValueOnce([makeComment('c1', 't1')])
    const store = useCommentStore()
    await store.loadComments('t1')
    expect(store.commentsByThread['t1']).toHaveLength(1)
  })

  it('createThread appends to threads and seeds the comment cache on success', async () => {
    const thread = makeThread('t1')
    const comment = makeComment('c1', 't1')
    engineMocks.createThread.mockResolvedValueOnce({
      validation: validResult(),
      thread,
      comment,
    })
    const store = useCommentStore()
    await store.createThread({
      roomId: 'r1',
      elementId: 'el-1',
      starter: { authorId: 'a', authorDisplayName: 'A', text: 'hi' },
    } as any)
    expect(store.threads.some((t) => t.threadId === 't1')).toBe(true)
    expect(store.commentsByThread['t1'][0].commentId).toBe('c1')
  })

  it('appendComment pushes the new comment and updates the thread row', async () => {
    const thread = makeThread('t1')
    listByRoomMock.mockResolvedValueOnce([thread])
    const store = useCommentStore()
    await store.loadThreads('r1')

    const updatedThread = { ...thread, commentCount: 1 }
    const comment = makeComment('c2', 't1', 'follow-up')
    engineMocks.appendComment.mockResolvedValueOnce({
      validation: validResult(),
      thread: updatedThread,
      comment,
    })
    await store.appendComment({
      roomId: 'r1',
      threadId: 't1',
      author: { authorId: 'a', authorDisplayName: 'A' },
      text: 'follow-up',
    } as any)
    expect(store.threads[0].commentCount).toBe(1)
    expect(store.commentsByThread['t1']).toContainEqual(comment)
  })

  it('resolveMentions delegates to the engine', () => {
    const members: MemberRecord[] = [
      {
        roomId: 'r1',
        memberId: 'm1',
        displayName: 'Alex',
        avatarColor: '#fff',
        role: RoomRole.Participant,
        state: MembershipState.Active,
        joinedAt: '2026-01-01T00:00:00.000Z',
        stateChangedAt: '2026-01-01T00:00:00.000Z',
        approvals: [],
      },
    ]
    engineMocks.resolveMentions.mockReturnValueOnce([
      { memberId: 'm1', displayName: 'Alex', isActive: true, state: MembershipState.Active },
    ] as any)
    const store = useCommentStore()
    const result = store.resolveMentions('al', members)
    expect(engineMocks.resolveMentions).toHaveBeenCalledWith('al', members, new Set())
    expect(result[0].memberId).toBe('m1')
  })

  describe('membership gate enforcement', () => {
    const blocked = {
      valid: false,
      errors: [{ field: 'membershipState', message: 'Non-active member.', code: 'invalid_transition' }],
    }

    it('blocks createThread for non-Active members and does not call the engine', async () => {
      membershipGateResult = blocked
      const store = useCommentStore()
      const result = await store.createThread({
        roomId: 'r1',
        elementId: 'el-1',
        starter: { authorId: 'a', authorDisplayName: 'A', text: 'hi' },
      } as any)
      expect(result.validation.valid).toBe(false)
      expect(engineMocks.createThread).not.toHaveBeenCalled()
    })

    it('blocks appendComment for non-Active members and does not call the engine', async () => {
      membershipGateResult = blocked
      getThreadByIdMock.mockResolvedValueOnce(makeThread('t1'))
      const store = useCommentStore()
      const result = await store.appendComment({
        threadId: 't1',
        authorId: 'a',
        authorDisplayName: 'A',
        text: 'blocked',
      } as any)
      expect(result.validation.valid).toBe(false)
      expect(engineMocks.appendComment).not.toHaveBeenCalled()
    })
  })
})
