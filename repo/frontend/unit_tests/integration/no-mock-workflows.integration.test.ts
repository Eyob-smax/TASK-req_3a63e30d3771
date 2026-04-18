import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { closeAll } from '@/services/webrtc-peer-service'
import { closeBroadcastChannel } from '@/services/broadcast-channel-service'
import { DB_NAME } from '@/models/constants'
import { ActivityEventType } from '@/models/activity'
import { MembershipState, RoomRole, type MemberRecord } from '@/models/room'
import { createProfile, verifyPassphrase } from '@/services/profile-service'
import { createRoom } from '@/engine/room-engine'
import { approveJoin, requestJoin } from '@/engine/membership-engine'
import { appendComment, createThread, listComments, resolveMentions } from '@/engine/comment-engine'
import { listPinned, listRecent, pinMessage, sendMessage } from '@/engine/chat-engine'
import { createSticky, deleteElement, listElements } from '@/engine/element-engine'
import { activityRepository } from '@/services/activity-repository'
import { memberRepository } from '@/services/member-repository'
import { roomRepository } from '@/services/room-repository'
import { elementRepository } from '@/services/element-repository'
import { commentThreadRepository } from '@/services/comment-thread-repository'
import { commentRepository } from '@/services/comment-repository'
import { chatMessageRepository } from '@/services/chat-message-repository'
import { pinnedMessageRepository } from '@/services/pinned-message-repository'
import { snapshotRepository } from '@/services/snapshot-repository'
import { buildBackupManifest } from '@/serializers/backup-serializer'
import { useImportExportStore } from '@/stores/import-export-store'

async function resetDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

describe('no-mock integration workflows', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    closeAll()
    closeBroadcastChannel()
    localStorage.clear()
    await resetDb()
  })

  it('runs profile + room + membership approval flow with real persistence', async () => {
    const host = await createProfile('Alice Host', '#2563eb', 'Password123!')
    const participant = await createProfile('Bob Participant', '#16a34a', 'Password456!')

    expect(await verifyPassphrase(host.profileId, 'Password123!')).toBe(true)
    expect(await verifyPassphrase(host.profileId, 'WrongPassphrase!')).toBe(false)

    const createResult = await createRoom({
      name: 'Integration Room',
      description: 'Room created by no-mock integration test',
      hostProfileId: host.profileId,
      hostDisplayName: host.displayName,
      hostAvatarColor: host.avatarColor,
      settings: {
        requireApproval: true,
        enableSecondReviewer: false,
      },
    })

    expect(createResult.validation.valid).toBe(true)
    expect(createResult.room).toBeDefined()

    const roomId = createResult.room!.roomId
    const persistedRoom = await roomRepository.getById(roomId)
    expect(persistedRoom?.name).toBe('Integration Room')

    const joinResult = await requestJoin(roomId, {
      roomId,
      requesterId: participant.profileId,
      displayName: participant.displayName,
      avatarColor: participant.avatarColor,
      requestedRole: RoomRole.Participant,
      requestedAt: new Date().toISOString(),
      pairingCode: createResult.room!.pairingCode,
    })

    expect(joinResult.validation.valid).toBe(true)
    expect(joinResult.member?.state).toBe(MembershipState.Requested)

    const approveResult = await approveJoin(roomId, participant.profileId, {
      memberId: host.profileId,
      displayName: host.displayName,
      role: RoomRole.Host,
    })

    expect(approveResult.validation.valid).toBe(true)
    expect(approveResult.member?.state).toBe(MembershipState.Active)

    const persistedParticipant = await memberRepository.find(roomId, participant.profileId)
    expect(persistedParticipant?.state).toBe(MembershipState.Active)
    expect((persistedParticipant?.approvals.length ?? 0) > 0).toBe(true)

    const activity = await activityRepository.listByRoom(roomId)
    expect(activity.some((event) => event.type === ActivityEventType.RoomCreated)).toBe(true)
    expect(activity.some((event) => event.type === ActivityEventType.MemberApproved)).toBe(true)
    expect(activity.some((event) => event.type === ActivityEventType.MemberJoined)).toBe(true)
  })

  it('runs chat + comment workflows with real engines and repositories', async () => {
    const host = await createProfile('Carol Host', '#7c3aed', 'Password789!')

    const createResult = await createRoom({
      name: 'Chat Room',
      description: 'Room for chat/comment integration',
      hostProfileId: host.profileId,
      hostDisplayName: host.displayName,
      hostAvatarColor: host.avatarColor,
      settings: {
        requireApproval: false,
        enableSecondReviewer: false,
      },
    })

    expect(createResult.validation.valid).toBe(true)
    const roomId = createResult.room!.roomId

    const messageResult = await sendMessage({
      roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'First integration chat message',
    })

    expect(messageResult.validation.valid).toBe(true)
    expect(messageResult.message?.text).toBe('First integration chat message')

    const recentMessages = await listRecent(roomId)
    expect(recentMessages.length).toBeGreaterThan(0)
    expect(recentMessages.some((m) => m.text === 'First integration chat message')).toBe(true)

    const actor = {
      memberId: host.profileId,
      displayName: host.displayName,
    }

    const pinResult = await pinMessage(roomId, messageResult.message!.messageId, actor)
    expect(pinResult.validation.valid).toBe(true)

    const pinned = await listPinned(roomId)
    expect(pinned.length).toBe(1)
    expect(pinned[0].messageId).toBe(messageResult.message!.messageId)

    const createThreadResult = await createThread({
      roomId,
      elementId: 'element-1',
      starter: {
        authorId: host.profileId,
        authorDisplayName: host.displayName,
        text: 'Initial thread comment',
      },
    })

    expect(createThreadResult.validation.valid).toBe(true)
    expect(createThreadResult.thread).toBeDefined()

    const appendResult = await appendComment({
      threadId: createThreadResult.thread!.threadId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'Follow-up comment for integration coverage',
    })

    expect(appendResult.validation.valid).toBe(true)

    const comments = await listComments(createThreadResult.thread!.threadId)
    expect(comments.length).toBe(2)
    expect(comments[0].text).toBe('Initial thread comment')
    expect(comments[1].text).toContain('Follow-up')

    const activeMember: MemberRecord = {
      roomId,
      memberId: host.profileId,
      displayName: host.displayName,
      avatarColor: host.avatarColor,
      role: RoomRole.Host,
      state: MembershipState.Active,
      joinedAt: new Date().toISOString(),
      stateChangedAt: new Date().toISOString(),
      approvals: [],
    }

    const historicalMember: MemberRecord = {
      roomId,
      memberId: 'left-member-1',
      displayName: 'Alex Left',
      avatarColor: '#ef4444',
      role: RoomRole.Participant,
      state: MembershipState.Left,
      joinedAt: new Date().toISOString(),
      stateChangedAt: new Date().toISOString(),
      approvals: [],
    }

    const mentionSuggestions = resolveMentions('a', [historicalMember, activeMember], new Set(['left-member-1']))

    expect(mentionSuggestions.length).toBe(2)
    expect(mentionSuggestions[0].isActive).toBe(true)
    expect(mentionSuggestions[0].memberId).toBe(host.profileId)
    expect(mentionSuggestions[1].memberId).toBe('left-member-1')

    const activity = await activityRepository.listByRoom(roomId)
    expect(activity.some((event) => event.type === ActivityEventType.MessagePinned)).toBe(true)
    expect(activity.filter((event) => event.type === ActivityEventType.CommentAdded).length).toBe(2)
  })

  it('runs canvas sticky lifecycle with real element engine and persistence', async () => {
    const host = await createProfile('Evan Host', '#14b8a6', 'Password222!')

    const createResult = await createRoom({
      name: 'Canvas Integration Room',
      description: 'Room for real element workflow coverage',
      hostProfileId: host.profileId,
      hostDisplayName: host.displayName,
      hostAvatarColor: host.avatarColor,
      settings: {
        requireApproval: false,
        enableSecondReviewer: false,
      },
    })

    expect(createResult.validation.valid).toBe(true)
    const roomId = createResult.room!.roomId

    const actor = {
      memberId: host.profileId,
      displayName: host.displayName,
    }

    const stickyResult = await createSticky({
      roomId,
      position: { x: 120, y: 80 },
      dimensions: { width: 180, height: 120 },
      text: 'Integration sticky note',
      backgroundColor: '#fef9c3',
      textColor: '#1e293b',
      fontSize: 14,
      actor,
    })

    expect(stickyResult.validation.valid).toBe(true)
    expect(stickyResult.element).toBeDefined()

    const elementsAfterCreate = await listElements(roomId)
    expect(elementsAfterCreate.length).toBe(1)
    expect(elementsAfterCreate[0].type).toBe('sticky-note')

    const deleteResult = await deleteElement(stickyResult.element!.elementId, actor)
    expect(deleteResult.validation.valid).toBe(true)

    const elementsAfterDelete = await listElements(roomId)
    expect(elementsAfterDelete.length).toBe(0)

    const activity = await activityRepository.listByRoom(roomId)
    expect(activity.some((event) => event.type === ActivityEventType.ElementCreated)).toBe(true)
    expect(activity.some((event) => event.type === ActivityEventType.ElementDeleted)).toBe(true)
  })

  it('validates and persists a backup manifest with real import/export store', async () => {
    const host = await createProfile('Dana Host', '#0ea5e9', 'Password111!')

    const createResult = await createRoom({
      name: 'Backup Integration Room',
      description: 'Room for backup validation and persistence flow',
      hostProfileId: host.profileId,
      hostDisplayName: host.displayName,
      hostAvatarColor: host.avatarColor,
      settings: {
        requireApproval: false,
        enableSecondReviewer: false,
      },
    })

    expect(createResult.validation.valid).toBe(true)
    const roomId = createResult.room!.roomId

    const chatResult = await sendMessage({
      roomId,
      authorId: host.profileId,
      authorDisplayName: host.displayName,
      text: 'Backup integration message',
    })
    expect(chatResult.validation.valid).toBe(true)

    const threadResult = await createThread({
      roomId,
      elementId: 'backup-element-1',
      starter: {
        authorId: host.profileId,
        authorDisplayName: host.displayName,
        text: 'Backup thread starter',
      },
    })
    expect(threadResult.validation.valid).toBe(true)

    const room = await roomRepository.getById(roomId)
    expect(room).toBeDefined()

    const manifest = buildBackupManifest({
      room: room!,
      members: await memberRepository.listByRoom(roomId),
      elements: await elementRepository.listByRoom(roomId),
      images: [],
      commentThreads: await commentThreadRepository.listByRoom(roomId),
      comments: await commentRepository.listByRoom(roomId),
      chatMessages: await chatMessageRepository.listByRoom(roomId),
      pinnedMessages: await pinnedMessageRepository.listByRoom(roomId),
      activityFeed: await activityRepository.listByRoom(roomId),
      snapshots: await snapshotRepository.listByRoom(roomId),
      exportedBy: host.displayName,
    })

    const importExportStore = useImportExportStore()
    const file = new File([JSON.stringify(manifest)], 'backup-integration.json', {
      type: 'application/json',
    })

    const validation = await importExportStore.validateImport(file)
    expect(validation?.success).toBe(true)
    expect((validation?.errorRows.length ?? 0) === 0).toBe(true)

    await importExportStore.persistImport(manifest)

    const persisted = await roomRepository.getById(roomId)
    expect(persisted?.name).toBe('Backup Integration Room')
    expect(importExportStore.lastError).toBeNull()
  })
})
