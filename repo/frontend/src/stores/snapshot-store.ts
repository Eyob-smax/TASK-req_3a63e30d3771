// REQ: R17 — Thin harness exposing snapshot + rollback engine to UI
// REQ: R1/R3/R4 — Manual snapshot + rollback require Active membership

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Snapshot, RollbackMetadata } from '@/models/snapshot'
import * as snapshotEngine from '@/engine/snapshot-engine'
import type { ActivityActor } from '@/engine/activity-engine'
import { useUiStore } from '@/stores/ui-store'
import { useElementStore } from '@/stores/element-store'
import { useChatStore } from '@/stores/chat-store'
import { useCommentStore } from '@/stores/comment-store'
import { useSessionStore } from '@/stores/session-store'
import { publishSnapshot, publishRollback } from '@/services/collab-publisher'
import { ensureActiveMembership } from '@/services/membership-gate'
import { logger } from '@/utils/logger'

export const useSnapshotStore = defineStore('snapshot', () => {
  const snapshots = ref<Snapshot[]>([])
  const isLoading = ref(false)
  const isRollingBack = ref(false)
  const lastError = ref<string | null>(null)
  const lastRollback = ref<RollbackMetadata | null>(null)

  async function refresh(roomId: string): Promise<void> {
    isLoading.value = true
    lastError.value = null
    try {
      snapshots.value = await snapshotEngine.listSnapshots(roomId)
    } catch (err) {
      logger.error('Failed to list snapshots', { roomId, err })
      lastError.value = 'Failed to load snapshots.'
    } finally {
      isLoading.value = false
    }
  }

  async function captureManual(roomId: string): Promise<Snapshot | null> {
    const session = useSessionStore()
    const actingMemberId = session.activeProfileId
    if (!actingMemberId) {
      lastError.value = 'No active profile to capture snapshot.'
      return null
    }
    const gate = await ensureActiveMembership(roomId, actingMemberId)
    if (!gate.valid) {
      lastError.value = gate.errors[0]?.message ?? 'You are not authorized to capture snapshots.'
      return null
    }
    try {
      const snap = await snapshotEngine.captureSnapshot(roomId, 'manual')
      snapshots.value.push(snap)
      publishSnapshot(roomId, snap.snapshotId, snap.sequenceNumber, 'local', snap)
      return snap
    } catch (err) {
      logger.error('Manual snapshot failed', { roomId, err })
      lastError.value = 'Failed to capture snapshot.'
      return null
    }
  }

  /**
   * One-click rollback with confirmation.
   * Uses the UI store's modal confirm — callers should ensure a ConfirmModal
   * is mounted (AppLayout provides one).
   */
  async function rollback(
    roomId: string,
    snapshotId: string,
    actor: ActivityActor
  ): Promise<RollbackMetadata | null> {
    const ui = useUiStore()
    const confirmed = await ui.confirm({
      title: 'Roll back to this snapshot?',
      message:
        'This creates a new state derived from the chosen snapshot. The snapshot timeline is preserved — nothing is deleted.',
      confirmLabel: 'Roll back',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return null

    const gate = await ensureActiveMembership(roomId, actor.memberId)
    if (!gate.valid) {
      lastError.value = gate.errors[0]?.message ?? 'You are not authorized to roll back.'
      ui.toast.error('Rollback blocked: active membership required.')
      return null
    }

    isRollingBack.value = true
    lastError.value = null
    try {
      const metadata = await snapshotEngine.rollbackTo(roomId, snapshotId, actor)
      lastRollback.value = metadata
      await refresh(roomId)
      await Promise.all([
        useElementStore().loadElements(roomId),
        useChatStore().loadChat(roomId),
        useCommentStore().loadThreads(roomId),
      ])
      const resultingSnapshot = snapshots.value.find(
        (s) => s.snapshotId === metadata.resultingSnapshotId
      )
      publishRollback(
        roomId,
        snapshotId,
        actor.memberId,
        metadata.resultingSnapshotId,
        actor.memberId,
        resultingSnapshot
      )
      ui.toast.success('Rollback complete')
      return metadata
    } catch (err) {
      logger.error('Rollback failed', { roomId, snapshotId, err })
      lastError.value = 'Rollback failed. Please try again.'
      ui.toast.error('Rollback failed')
      return null
    } finally {
      isRollingBack.value = false
    }
  }

  return {
    snapshots,
    isLoading,
    isRollingBack,
    lastError,
    lastRollback,
    refresh,
    captureManual,
    rollback,
  }
})
