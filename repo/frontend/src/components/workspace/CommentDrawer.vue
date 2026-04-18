<script setup lang="ts">
// REQ: R7 — Comment drawer: threads, append, @mention autocomplete, 200-cap guard

import { ref, computed, watch, onMounted } from 'vue'
import { useCommentStore } from '@/stores/comment-store'
import { useRoomStore } from '@/stores/room-store'
import { useUiStore } from '@/stores/ui-store'
import { MAX_COMMENTS_PER_THREAD } from '@/models/constants'
import type { ActivityActor } from '@/engine/activity-engine'
import LimitIndicator from '@/components/LimitIndicator.vue'
import LoadingSpinner from '@/components/LoadingSpinner.vue'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps<{
  roomId: string
  elementId: string | null
  actor: ActivityActor
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const commentStore = useCommentStore()
const roomStore = useRoomStore()
const uiStore = useUiStore()

const newCommentText = ref('')
const mentionQuery = ref('')
const showMentions = ref(false)
const isSubmitting = ref(false)

const activeThread = computed(() => {
  if (!props.elementId) return null
  return commentStore.threads.find((t) => t.elementId === props.elementId) ?? null
})

const threadComments = computed(() => {
  if (!activeThread.value) return []
  return commentStore.commentsByThread[activeThread.value.threadId] ?? []
})

const threadCommentCount = computed(() => {
  if (!activeThread.value) return 0
  return Math.max(activeThread.value.commentCount, threadComments.value.length)
})

const atCommentCap = computed(() => {
  return threadCommentCount.value >= MAX_COMMENTS_PER_THREAD
})

// @mention suggestion handling
const mentionSuggestions = computed(() => {
  if (!mentionQuery.value) return []
  const historicalIds = new Set(threadComments.value.map((c) => c.authorId))
  return commentStore.resolveMentions(mentionQuery.value, roomStore.members, historicalIds)
})

function onInput(event: Event): void {
  const text = (event.target as HTMLTextAreaElement).value
  newCommentText.value = text
  // detect @mention trigger
  const match = /@(\w*)$/.exec(text)
  if (match) {
    mentionQuery.value = match[1]
    showMentions.value = true
  } else {
    showMentions.value = false
    mentionQuery.value = ''
  }
}

function selectMention(displayName: string): void {
  newCommentText.value = newCommentText.value.replace(/@\w*$/, `@${displayName} `)
  showMentions.value = false
  mentionQuery.value = ''
}

async function submitComment(): Promise<void> {
  const text = newCommentText.value.trim()
  if (!text || props.disabled || isSubmitting.value) return
  isSubmitting.value = true

  try {
    if (activeThread.value) {
      const result = await commentStore.appendComment({
        threadId: activeThread.value.threadId,
        roomId: props.roomId,
        authorId: props.actor.memberId,
        authorDisplayName: props.actor.displayName,
        text,
        mentions: [],
      })
      if (!result.validation.valid) {
        uiStore.toast.error(result.validation.errors[0]?.message ?? 'Comment failed.')
      } else {
        newCommentText.value = ''
      }
    } else if (props.elementId) {
      const result = await commentStore.createThread({
        roomId: props.roomId,
        elementId: props.elementId,
        authorId: props.actor.memberId,
        authorDisplayName: props.actor.displayName,
        text,
        mentions: [],
      })
      if (!result.validation.valid) {
        uiStore.toast.error(result.validation.errors[0]?.message ?? 'Thread creation failed.')
      } else {
        newCommentText.value = ''
        if (result.thread) {
          await commentStore.loadComments(result.thread.threadId)
        }
      }
    }
  } finally {
    isSubmitting.value = false
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch { return '' }
}

watch(() => activeThread.value?.threadId, async (threadId) => {
  if (threadId) await commentStore.loadComments(threadId)
})

onMounted(async () => {
  if (activeThread.value?.threadId) {
    await commentStore.loadComments(activeThread.value.threadId)
  }
})
</script>

<template>
  <transition name="drawer-slide">
    <div v-if="elementId" class="comment-drawer">
      <div class="comment-drawer__header">
        <span class="comment-drawer__title">Comments</span>
        <button class="comment-drawer__close" aria-label="Close comments" data-testid="comment-drawer-close" @click="emit('close')">×</button>
      </div>

      <!-- Loading -->
      <div v-if="commentStore.isLoading" class="comment-drawer__loading">
        <LoadingSpinner size="sm" />
      </div>

      <template v-else>
        <!-- Thread comments -->
        <div class="comment-drawer__comments">
          <EmptyState
            v-if="threadComments.length === 0"
            icon="💬"
            title="No comments yet"
            description="Be the first to comment on this element."
          />

          <div
            v-for="comment in threadComments.filter(c => !c.isDeleted)"
            :key="comment.commentId"
            class="comment-drawer__comment"
          >
            <div class="comment-drawer__comment-meta">
              <span class="comment-drawer__comment-author">{{ comment.authorDisplayName }}</span>
              <span class="comment-drawer__comment-time">{{ formatTime(comment.createdAt) }}</span>
            </div>
            <p class="comment-drawer__comment-text">{{ comment.text }}</p>
          </div>
        </div>

        <!-- Cap indicator -->
        <div v-if="activeThread" class="comment-drawer__cap">
          <LimitIndicator
            :current="threadCommentCount"
            :max="MAX_COMMENTS_PER_THREAD"
            label="comments"
          />
        </div>

        <!-- Compose area -->
        <div class="comment-drawer__compose" :class="{ 'comment-drawer__compose--disabled': disabled }">
          <div class="comment-drawer__input-wrap">
            <textarea
              :value="newCommentText"
              class="comment-drawer__input"
              data-testid="comment-input"
              placeholder="Add a comment… (@mention members)"
              rows="3"
              :disabled="disabled || atCommentCap || isSubmitting"
              @input="onInput"
            />
            <!-- Mention suggestions dropdown -->
            <div v-if="showMentions && mentionSuggestions.length > 0" class="comment-drawer__mentions">
              <button
                v-for="suggestion in mentionSuggestions"
                :key="suggestion.memberId"
                class="comment-drawer__mention-item"
                :class="{ 'comment-drawer__mention-item--inactive': !suggestion.isActive }"
                @click="selectMention(suggestion.displayName)"
              >
                {{ suggestion.displayName }}
                <span v-if="!suggestion.isActive" class="comment-drawer__mention-inactive">(left)</span>
              </button>
            </div>
          </div>

          <p v-if="atCommentCap" class="comment-drawer__cap-msg">
            Thread has reached the {{ MAX_COMMENTS_PER_THREAD }}-comment limit.
          </p>

          <button
            class="comment-drawer__submit"
            data-testid="comment-submit"
            :disabled="!newCommentText.trim() || disabled || atCommentCap || isSubmitting"
            @click="submitComment"
          >
            {{ isSubmitting ? 'Posting…' : 'Post' }}
          </button>
        </div>
      </template>
    </div>
  </transition>
</template>

<style scoped>
.comment-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 16rem;
  background: #fff;
  border-left: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  z-index: 50;
  box-shadow: -4px 0 12px rgba(0,0,0,0.07);
}

.comment-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.comment-drawer__title { font-size: 0.875rem; font-weight: 600; color: #1e293b; }

.comment-drawer__close {
  background: none; border: none; cursor: pointer; color: #94a3b8;
  font-size: 1.125rem; line-height: 1; padding: 0.125rem;
}

.comment-drawer__loading { display: flex; justify-content: center; padding: 1.5rem; }

.comment-drawer__comments {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.comment-drawer__comment { display: flex; flex-direction: column; gap: 0.125rem; }

.comment-drawer__comment-meta { display: flex; align-items: center; gap: 0.375rem; }
.comment-drawer__comment-author { font-size: 0.75rem; font-weight: 600; color: #475569; }
.comment-drawer__comment-time { font-size: 0.625rem; color: #94a3b8; }

.comment-drawer__comment-text {
  margin: 0;
  font-size: 0.8125rem;
  color: #1e293b;
  line-height: 1.4;
  word-break: break-word;
}

.comment-drawer__cap { padding: 0.25rem 0.75rem; flex-shrink: 0; }

.comment-drawer__compose {
  flex-shrink: 0;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.comment-drawer__compose--disabled { opacity: 0.5; }

.comment-drawer__input-wrap { position: relative; }

.comment-drawer__input {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  font-family: inherit;
  resize: none;
  line-height: 1.4;
  box-sizing: border-box;
}
.comment-drawer__input:focus { outline: none; border-color: #2563eb; }
.comment-drawer__input:disabled { background: #f8fafc; }

.comment-drawer__mentions {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 100;
  max-height: 10rem;
  overflow-y: auto;
}

.comment-drawer__mention-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.375rem 0.625rem;
  font-size: 0.8125rem;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  color: #1e293b;
}
.comment-drawer__mention-item:hover { background: #f1f5f9; }
.comment-drawer__mention-item--inactive { color: #94a3b8; }
.comment-drawer__mention-inactive { font-size: 0.6875rem; }

.comment-drawer__cap-msg {
  font-size: 0.75rem;
  color: #dc2626;
  margin: 0;
}

.comment-drawer__submit {
  padding: 0.375rem 0.75rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.8125rem;
  cursor: pointer;
  align-self: flex-end;
}
.comment-drawer__submit:hover:not(:disabled) { background: #1d4ed8; }
.comment-drawer__submit:disabled { background: #93c5fd; cursor: not-allowed; }

.drawer-slide-enter-active,
.drawer-slide-leave-active { transition: transform 0.2s ease; }
.drawer-slide-enter-from,
.drawer-slide-leave-to { transform: translateX(100%); }
</style>
