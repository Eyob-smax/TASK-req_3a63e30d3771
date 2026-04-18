<script setup lang="ts">
// REQ: R1/R2/R3/R4/R5/R6/R7/R8/R9/R10/R11/R12/R13/R14/R15/R16/R17/R18/R19
// Primary workspace: mounts layout, wires all stores, adaptors, autosave

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRoomStore } from '@/stores/room-store'
import { useElementStore } from '@/stores/element-store'
import { useChatStore } from '@/stores/chat-store'
import { useCommentStore } from '@/stores/comment-store'
import { useSnapshotStore } from '@/stores/snapshot-store'
import { useActivityStore } from '@/stores/activity-store'
import { usePresenceStore } from '@/stores/presence-store'
import { useSessionStore } from '@/stores/session-store'
import { useUiStore } from '@/stores/ui-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { attachRoomBroadcast } from '@/services/broadcast-adaptor'
import { attachWebRTCAdaptor } from '@/services/webrtc-adaptor'
import { publishPresence } from '@/services/collab-publisher'
import { elementRepository } from '@/services/element-repository'
import { startRoomScheduler, stopRoomScheduler } from '@/engine/autosave-scheduler'
import { RoomRole, MembershipState } from '@/models/room'
import { canMemberAct } from '@/validators/room-validators'
import AppLayout from '@/layouts/AppLayout.vue'
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout.vue'
import WorkspaceToolbar from '@/components/workspace/WorkspaceToolbar.vue'
import WorkspaceToolSidebar from '@/components/workspace/WorkspaceToolSidebar.vue'
import CanvasHost from '@/components/workspace/CanvasHost.vue'
import ChatPanel from '@/components/workspace/ChatPanel.vue'
import CommentDrawer from '@/components/workspace/CommentDrawer.vue'
import ActivityFeedPanel from '@/components/workspace/ActivityFeedPanel.vue'
import MemberListSidebar from '@/components/workspace/MemberListSidebar.vue'
import SnapshotDrawer from '@/components/workspace/SnapshotDrawer.vue'
import PairingPanel from '@/components/workspace/PairingPanel.vue'
import PresenceAvatarStack from '@/components/workspace/PresenceAvatarStack.vue'
import CursorOverlay from '@/components/workspace/CursorOverlay.vue'
import type { ActivityActor } from '@/engine/activity-engine'

const props = defineProps<{ roomId: string }>()

const workspaceLayout = ref<InstanceType<typeof WorkspaceLayout> | null>(null)

const router = useRouter()
const roomStore = useRoomStore()
const elementStore = useElementStore()
const chatStore = useChatStore()
const commentStore = useCommentStore()
const snapshotStore = useSnapshotStore()
const activityStore = useActivityStore()
const presenceStore = usePresenceStore()
const sessionStore = useSessionStore()
const uiStore = useUiStore()
const preferencesStore = usePreferencesStore()

type ToolMode = 'select' | 'sticky' | 'arrow' | 'pen' | 'image'
type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

const activeTool = ref<ToolMode>((preferencesStore.lastTool as ToolMode) ?? 'select')
const selectedElementId = ref<string | null>(null)
const showCommentDrawer = ref(false)
const showPairingPanel = ref(false)
const isInitialized = ref(false)
const autosaveStatus = ref<AutosaveStatus>('idle')
const lastSavedAt = ref<string | null>(null)

let cleanupBroadcast: (() => void) | null = null
let cleanupWebRTC: (() => void) | null = null

const activeMember = computed(() => {
  if (!sessionStore.activeProfileId) return null
  return roomStore.members.find((m) => m.memberId === sessionStore.activeProfileId) ?? null
})

const isHost = computed(() => activeMember.value?.role === RoomRole.Host)

const isReviewer = computed(() =>
  activeMember.value?.role === RoomRole.Host ||
  activeMember.value?.role === RoomRole.Reviewer
)

const isStale = computed(() => activeMember.value?.state === MembershipState.Left)

const canAct = computed(() => canMemberAct(activeMember.value?.state))

const actor = computed<ActivityActor>(() => ({
  memberId:
    activeMember.value?.memberId ??
    sessionStore.activeProfileId ??
    'unknown',
  displayName:
    activeMember.value?.displayName ??
    sessionStore.activeProfile?.displayName ??
    'Unknown',
}))

function onCursorMove(position: { x: number; y: number }): void {
  if (!sessionStore.activeProfileId) return
  const cursor = {
    x: position.x,
    y: position.y,
    timestamp: Date.now(),
  }
  presenceStore.updateCursor(sessionStore.activeProfileId, cursor)
  publishPresence(
    props.roomId,
    sessionStore.activeProfileId,
    cursor,
    actor.value.displayName,
    activeMember.value?.avatarColor ?? sessionStore.activeProfile?.avatarColor ?? '#888',
  )
}

function selectTool(tool: ToolMode): void {
  activeTool.value = tool
  preferencesStore.setLastTool(tool)
}

function onElementSelected(elementId: string | null): void {
  selectedElementId.value = elementId
  if (!elementId) showCommentDrawer.value = false
}

function openCommentDrawer(elementId: string): void {
  selectedElementId.value = elementId
  showCommentDrawer.value = true
}

function closeCommentDrawer(): void {
  showCommentDrawer.value = false
}

function openPairingPanel(): void {
  showPairingPanel.value = true
}

function closePairingPanel(): void {
  showPairingPanel.value = false
}

function openBackup(): void {
  router.push({ name: 'workspace-backup', params: { roomId: props.roomId } })
}

async function captureSnapshot(): Promise<void> {
  if (!roomStore.activeRoom) return
  const actor = {
    memberId: activeMember.value?.memberId ?? '',
    displayName: activeMember.value?.displayName ?? '',
    role: activeMember.value?.role ?? RoomRole.Participant,
  }
  await snapshotStore.captureManual(props.roomId)
  uiStore.toast.success('Snapshot captured.')
}

onMounted(async () => {
  try {
    await roomStore.loadRoom(props.roomId)
    if (!roomStore.activeRoom) {
      uiStore.toast.error('Room not found.')
      await router.push({ name: 'room-list' })
      return
    }

    // Enforce active membership before entering the workspace. Non-Active members
    // (missing, Requested, PendingSecondApproval, Left, Rejected) must not be able
    // to act on the room's data or attach broadcast/WebRTC adaptors.
    const member = activeMember.value
    if (!member) {
      uiStore.toast.error('You are not a member of this room.')
      await router.push({ name: 'room-list' })
      return
    }
    if (member.state !== MembershipState.Active) {
      const pairingCode = roomStore.activeRoom.pairingCode
      if (
        member.state === MembershipState.Requested ||
        member.state === MembershipState.PendingSecondApproval
      ) {
        uiStore.toast.info('Your join request is still awaiting approval.')
        await router.push({ name: 'room-join', query: pairingCode ? { code: pairingCode } : {} })
      } else if (member.state === MembershipState.Rejected) {
        uiStore.toast.error('Your join request was rejected.')
        await router.push({ name: 'room-list' })
      } else {
        uiStore.toast.error('You have left this room.')
        await router.push({ name: 'room-list' })
      }
      return
    }

    await Promise.all([
      elementStore.loadElements(props.roomId),
      chatStore.loadChat(props.roomId),
      commentStore.loadThreads(props.roomId),
      snapshotStore.refresh(props.roomId),
      activityStore.refresh(props.roomId),
    ])

    presenceStore.attach(props.roomId)

    cleanupBroadcast = attachRoomBroadcast(props.roomId)
    cleanupWebRTC = attachWebRTCAdaptor(props.roomId)

    startRoomScheduler(props.roomId, {
      onAutoSave: async () => {
        if (!canAct.value) return
        autosaveStatus.value = 'saving'
        try {
          // Explicit per-cycle IndexedDB health check: verifies storage is responsive.
          await elementRepository.countByRoom(props.roomId)
          const hasStoreError = !!(
            elementStore.lastError ||
            chatStore.lastError ||
            commentStore.lastError
          )
          autosaveStatus.value = hasStoreError ? 'failed' : 'saved'
          if (!hasStoreError) lastSavedAt.value = new Date().toISOString()
        } catch {
          autosaveStatus.value = 'failed'
        }
      },
      onSnapshot: async () => {
        if (!roomStore.activeRoom || isStale.value) return
        try {
          await snapshotStore.captureManual(props.roomId)
        } catch {
          // Silent — scheduled snapshots should not surface errors as toasts
        }
      },
    })

    isInitialized.value = true
  } catch (err) {
    uiStore.toast.error('Failed to load workspace.')
  }
})

onUnmounted(() => {
  stopRoomScheduler(props.roomId)
  cleanupBroadcast?.()
  cleanupWebRTC?.()
})

watch(isStale, (stale) => {
  if (stale) {
    uiStore.addBanner('You have left this room. Actions are read-only.', 'warning', false)
  }
})
</script>

<template>
  <AppLayout>
    <template v-if="!isInitialized && roomStore.isLoading">
      <div class="workspace-page__loading">
        <div class="workspace-page__spinner" />
        <p>Loading workspace…</p>
      </div>
    </template>

    <template v-else-if="roomStore.activeRoom">
      <!-- Pairing panel overlay -->
      <div v-if="showPairingPanel" class="workspace-page__pairing-overlay" @click.self="closePairingPanel">
        <div class="workspace-page__pairing-card">
          <div class="workspace-page__pairing-header">
            <h2 class="workspace-page__pairing-title">Connect a Peer</h2>
            <button class="workspace-page__pairing-close" @click="closePairingPanel">✕</button>
          </div>
          <PairingPanel :room-id="roomId" :is-host="isHost" />
        </div>
      </div>

      <WorkspaceLayout ref="workspaceLayout">
        <template #toolbar>
          <WorkspaceToolbar
            :room-name="roomStore.activeRoom.name"
            :active-tool="activeTool"
            :element-count="elementStore.elements.length"
            :member-count="roomStore.activeMembers.length"
            :disabled="!canAct"
            :autosave-status="autosaveStatus"
            :last-saved-at="lastSavedAt"
            :can-rollback="isHost"
            @tool-change="selectTool"
            @open-pairing="openPairingPanel"
            @open-backup="openBackup"
            @open-snapshots="() => workspaceLayout?.openPanel('snapshots')"
            @open-members="() => workspaceLayout?.openPanel('members')"
          >
            <template #presence>
              <PresenceAvatarStack :members="presenceStore.onlineAvatars" />
            </template>
          </WorkspaceToolbar>
        </template>

        <template #tool-sidebar>
          <WorkspaceToolSidebar
            :active-tool="activeTool"
            :disabled="!canAct"
            @tool-selected="selectTool"
          />
        </template>

        <template #canvas>
          <div class="workspace-page__canvas-wrapper">
            <CanvasHost
              :room-id="roomId"
              :active-tool="activeTool"
              :actor="actor"
              :disabled="!canAct"
              @element-selected="onElementSelected"
              @open-comments="openCommentDrawer"
              @cursor-move="onCursorMove"
            />
            <CursorOverlay :self-member-id="sessionStore.activeProfileId ?? null" />
          </div>
        </template>

        <template #chat-panel>
          <ChatPanel
            :room-id="roomId"
            :actor="actor"
            :disabled="!canAct"
          />
        </template>

        <template #activity-panel>
          <ActivityFeedPanel :room-id="roomId" />
        </template>

        <template #member-list>
          <MemberListSidebar
            :room-id="roomId"
            :is-host="isHost"
            :is-reviewer="isReviewer"
            :active-profile-id="sessionStore.activeProfileId ?? ''"
          />
        </template>

        <template #snapshot-drawer>
          <SnapshotDrawer
            :room-id="roomId"
            :is-host="isHost"
          />
        </template>

        <template #comment-drawer>
          <CommentDrawer
            :element-id="showCommentDrawer ? (selectedElementId ?? '') : ''"
            :room-id="roomId"
            :actor="actor"
            :disabled="!canAct"
            @close="closeCommentDrawer"
          />
        </template>
      </WorkspaceLayout>
    </template>

    <template v-else>
      <div class="workspace-page__error">
        <p>Room not found or could not be loaded.</p>
        <router-link to="/rooms" class="workspace-page__back-link">Back to Rooms</router-link>
      </div>
    </template>
  </AppLayout>
</template>

<style scoped>
.workspace-page__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 1rem;
  color: #64748b;
  font-size: 0.875rem;
}

.workspace-page__spinner {
  width: 2rem;
  height: 2rem;
  border: 3px solid #e2e8f0;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: workspace-spin 0.7s linear infinite;
}

@keyframes workspace-spin {
  to { transform: rotate(360deg); }
}

.workspace-page__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 1rem;
  color: #64748b;
  font-size: 0.875rem;
}

.workspace-page__back-link {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
}
.workspace-page__back-link:hover { text-decoration: underline; }

.workspace-page__canvas-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.workspace-page__pairing-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 4rem 1rem;
}

.workspace-page__pairing-card {
  background: #fff;
  border-radius: 8px;
  width: 100%;
  max-width: 28rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.workspace-page__pairing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
  border-bottom: 1px solid #e2e8f0;
}

.workspace-page__pairing-title {
  font-size: 1rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0;
}

.workspace-page__pairing-close {
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: #64748b;
  padding: 0.25rem;
  line-height: 1;
}
.workspace-page__pairing-close:hover { color: #1e293b; }
</style>
