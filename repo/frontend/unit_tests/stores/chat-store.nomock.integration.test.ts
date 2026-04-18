import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { setupNoMockTestEnv, seedActiveHostRoom, seedActiveSessionProfile } from '../integration/no-mock-test-harness'
import { chatMessageRepository } from '@/services/chat-message-repository'
import { pinnedMessageRepository } from '@/services/pinned-message-repository'
import { memberRepository } from '@/services/member-repository'
import { MembershipState, RoomRole } from '@/models/room'

function actor(memberId: string, displayName: string) {
  return { memberId, displayName, role: RoomRole.Host }
}

describe('chat-store no-mock integration', () => {
  beforeEach(async () => {
    await setupNoMockTestEnv()
  })

  it('loads empty chat state for a new room', async () => {
    const { room } = await seedActiveHostRoom()
    const store = useChatStore()

    await store.loadChat(room.roomId)

    expect(store.messages.length).toBe(0)
    expect(store.pinned.length).toBe(0)
    expect(store.lastError).toBeNull()
  })

  it('sendMessage persists and refreshes recent list', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const sent = await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'hello no-mock',
    })

    expect(sent.validation.valid).toBe(true)
    expect(store.messages.some((m) => m.text === 'hello no-mock')).toBe(true)

    const persisted = await chatMessageRepository.listByRoom(room.roomId)
    expect(persisted.some((m) => m.text === 'hello no-mock')).toBe(true)
  })

  it('sendMessage stores mentions payload', async () => {
    const { room, host } = await seedActiveHostRoom()
    const mentioned = await seedActiveSessionProfile({ displayName: 'Mentioned User' })
    const store = useChatStore()

    await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'hi @Mentioned User',
      mentions: [{ memberId: mentioned.profileId, displayName: mentioned.displayName }],
    })

    const persisted = await chatMessageRepository.listByRoom(room.roomId)
    expect(persisted[0].mentions[0].memberId).toBe(mentioned.profileId)
  })

  it('keeps chronological ordering from repository list', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    await store.sendMessage({ roomId: room.roomId, authorId: host.profileId, authorDisplayName: host.displayName, text: 'one' })
    await store.sendMessage({ roomId: room.roomId, authorId: host.profileId, authorDisplayName: host.displayName, text: 'two' })
    await store.sendMessage({ roomId: room.roomId, authorId: host.profileId, authorDisplayName: host.displayName, text: 'three' })

    await store.loadChat(room.roomId)

    expect(store.messages.map((m) => m.text)).toEqual(['one', 'two', 'three'])
  })

  it('pinMessage adds pinned reference on success', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const sent = await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'pin me',
    })

    const pin = await store.pinMessage(room.roomId, sent.message!.messageId, actor(host.profileId, host.displayName))

    expect(pin.validation.valid).toBe(true)
    expect(store.pinned.some((p) => p.messageId === sent.message!.messageId)).toBe(true)
  })

  it('pinMessage rejects duplicate pin for same message', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const sent = await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'duplicate pin',
    })

    await store.pinMessage(room.roomId, sent.message!.messageId, actor(host.profileId, host.displayName))
    const duplicate = await store.pinMessage(room.roomId, sent.message!.messageId, actor(host.profileId, host.displayName))

    expect(duplicate.validation.valid).toBe(false)
    expect(duplicate.validation.errors[0]?.code).toBe('duplicate')
  })

  it('enforces max of three pinned messages per room', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const sent = [] as string[]
    for (let i = 0; i < 4; i += 1) {
      const m = await store.sendMessage({
        roomId: room.roomId,
        authorId: host.profileId,
        authorDisplayName: host.displayName,
        text: `msg-${i}`,
      })
      sent.push(m.message!.messageId)
    }

    const first = await store.pinMessage(room.roomId, sent[0], actor(host.profileId, host.displayName))
    const second = await store.pinMessage(room.roomId, sent[1], actor(host.profileId, host.displayName))
    const third = await store.pinMessage(room.roomId, sent[2], actor(host.profileId, host.displayName))
    const fourth = await store.pinMessage(room.roomId, sent[3], actor(host.profileId, host.displayName))

    expect(first.validation.valid).toBe(true)
    expect(second.validation.valid).toBe(true)
    expect(third.validation.valid).toBe(true)
    expect(fourth.validation.valid).toBe(false)
  })

  it('unpinMessage removes existing pinned reference', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const sent = await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'to unpin',
    })

    await store.pinMessage(room.roomId, sent.message!.messageId, actor(host.profileId, host.displayName))
    const unpin = await store.unpinMessage(room.roomId, sent.message!.messageId, actor(host.profileId, host.displayName))

    expect(unpin.valid).toBe(true)
    expect(store.pinned.find((p) => p.messageId === sent.message!.messageId)).toBeUndefined()
  })

  it('unpinMessage returns not_found when message is not pinned', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const unpin = await store.unpinMessage(room.roomId, 'missing-message', actor(host.profileId, host.displayName))

    expect(unpin.valid).toBe(false)
    expect(unpin.errors[0]?.code).toBe('not_found')
  })

  it('stores pin metadata in repository', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const sent = await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'metadata pin',
    })

    await store.pinMessage(room.roomId, sent.message!.messageId, actor(host.profileId, host.displayName))
    const pinned = await pinnedMessageRepository.find(room.roomId, sent.message!.messageId)

    expect(pinned?.pinnedBy).toBe(host.profileId)
  })

  it('loadChat reflects persisted pin and message state after fresh read', async () => {
    const { room, host } = await seedActiveHostRoom()
    const store = useChatStore()

    const sent = await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'fresh read message',
    })

    await store.pinMessage(room.roomId, sent.message!.messageId, actor(host.profileId, host.displayName))

    const freshStore = useChatStore()
    freshStore.messages = []
    freshStore.pinned = []

    await freshStore.loadChat(room.roomId)

    expect(freshStore.messages.length).toBe(1)
    expect(freshStore.pinned.length).toBe(1)
  })

  it('supports participant actor for pin operations', async () => {
    const { room, host } = await seedActiveHostRoom()
    const participant = await seedActiveSessionProfile({ displayName: 'Participant Actor' })
    await memberRepository.put({
      roomId: room.roomId,
      memberId: participant.profileId,
      displayName: participant.displayName,
      avatarColor: participant.avatarColor,
      role: RoomRole.Participant,
      state: MembershipState.Active,
      joinedAt: new Date().toISOString(),
      stateChangedAt: new Date().toISOString(),
      approvals: [],
    } as any)
    const store = useChatStore()

    const sent = await store.sendMessage({
      roomId: room.roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'participant pin',
    })

    const pin = await store.pinMessage(room.roomId, sent.message!.messageId, {
      memberId: participant.profileId,
      displayName: participant.displayName,
      role: RoomRole.Participant,
    })

    expect(pin.validation.valid).toBe(true)
  })
})
