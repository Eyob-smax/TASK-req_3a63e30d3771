// REQ: R8 — Thin harness exposing chat engine to UI
// REQ: R1/R3/R4 — Write paths block non-Active members via ensureActiveMembership

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage, PinnedMessage } from '@/models/chat'
import * as chatEngine from '@/engine/chat-engine'
import { publishChat, publishPin, publishConflict } from '@/services/collab-publisher'
import { getLocalTabId } from '@/services/broadcast-channel-service'
import { ensureActiveMembership } from '@/services/membership-gate'
import { logger } from '@/utils/logger'

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const pinned = ref<PinnedMessage[]>([])
  const isLoading = ref(false)
  const lastError = ref<string | null>(null)

  async function loadChat(roomId: string): Promise<void> {
    isLoading.value = true
    lastError.value = null
    try {
      messages.value = await chatEngine.listRecent(roomId)
      pinned.value = await chatEngine.listPinned(roomId)
    } catch (err) {
      logger.error('Failed to load chat', { roomId, err })
      lastError.value = 'Failed to load chat messages.'
    } finally {
      isLoading.value = false
    }
  }

  async function sendMessage(input: chatEngine.SendMessageInput) {
    const gate = await ensureActiveMembership(input.roomId, input.authorId)
    if (!gate.valid) return { validation: gate }
    const result = await chatEngine.sendMessage(input)
    if (result.message) {
      // Refresh to reflect retention trim (oldest may have been removed).
      messages.value = await chatEngine.listRecent(input.roomId)
      publishChat(
        input.roomId,
        'new',
        result.message.messageId,
        result.message.authorId,
        result.message
      )
    }
    return result
  }

  async function pinMessage(
    roomId: string,
    messageId: string,
    actor: Parameters<typeof chatEngine.pinMessage>[2]
  ) {
    const gate = await ensureActiveMembership(roomId, actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await chatEngine.pinMessage(roomId, messageId, actor)
    if (result.pinned) {
      pinned.value.push(result.pinned)
      publishPin(roomId, 'pin', messageId, actor.memberId, result.pinned)
    } else if (!result.validation.valid) {
      const err = result.validation.errors[0]
      if (err && (err.code === 'duplicate' || err.code === 'max_count' || err.code === 'cap_exceeded')) {
        publishConflict(
          roomId,
          'pin-collision',
          messageId,
          getLocalTabId(),
          err.message,
          actor.memberId,
        )
      }
    }
    return result
  }

  async function unpinMessage(
    roomId: string,
    messageId: string,
    actor: Parameters<typeof chatEngine.unpinMessage>[2]
  ) {
    const gate = await ensureActiveMembership(roomId, actor.memberId)
    if (!gate.valid) return gate
    const result = await chatEngine.unpinMessage(roomId, messageId, actor)
    if (result.valid) {
      pinned.value = pinned.value.filter((p) => p.messageId !== messageId)
      publishPin(roomId, 'unpin', messageId, actor.memberId)
    }
    return result
  }

  return {
    messages,
    pinned,
    isLoading,
    lastError,
    loadChat,
    sendMessage,
    pinMessage,
    unpinMessage,
  }
})
