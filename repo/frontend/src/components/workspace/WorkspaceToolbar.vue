<script setup lang="ts">
// REQ: R5/R16/R17 — Workspace toolbar: tool selector, room info, autosave indicator, snapshot access

import { computed } from 'vue'
import LimitIndicator from '@/components/LimitIndicator.vue'
import AutosaveIndicator from '@/components/workspace/AutosaveIndicator.vue'
import { MAX_ELEMENTS_PER_ROOM } from '@/models/constants'
import type { ToolType } from '@/stores/preferences-store'

const props = defineProps<{
  roomName: string
  activeTool: ToolType
  elementCount: number
  memberCount: number
  canRollback?: boolean
  autosaveStatus?: 'idle' | 'saving' | 'saved' | 'failed'
  lastSavedAt?: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'tool-change', tool: ToolType): void
  (e: 'open-snapshots'): void
  (e: 'open-members'): void
  (e: 'open-backup'): void
  (e: 'open-pairing'): void
}>()

const tools: Array<{ key: ToolType; label: string; shortcut: string }> = [
  { key: 'select', label: 'Select', shortcut: 'V' },
  { key: 'sticky', label: 'Sticky', shortcut: 'S' },
  { key: 'arrow', label: 'Arrow', shortcut: 'A' },
  { key: 'pen', label: 'Pen', shortcut: 'P' },
  { key: 'image', label: 'Image', shortcut: 'I' },
]

const atElementCap = computed(() => props.elementCount >= MAX_ELEMENTS_PER_ROOM)
</script>

<template>
  <div class="ws-toolbar">
    <!-- Room name -->
    <span class="ws-toolbar__room-name" :title="roomName">{{ roomName }}</span>

    <div class="ws-toolbar__divider" />

    <!-- Tool selector -->
    <div class="ws-toolbar__tools" role="toolbar" aria-label="Drawing tools">
      <button
        v-for="tool in tools"
        :key="tool.key"
        class="ws-toolbar__tool"
        :class="{ 'ws-toolbar__tool--active': activeTool === tool.key }"
        :data-testid="`tool-${tool.key}`"
        :title="`${tool.label} (${tool.shortcut})`"
        :disabled="(atElementCap && tool.key !== 'select') || disabled"
        @click="emit('tool-change', tool.key)"
      >
        {{ tool.label }}
      </button>
    </div>

    <div class="ws-toolbar__divider" />

    <!-- Element limit indicator -->
    <LimitIndicator
      :current="elementCount"
      :max="MAX_ELEMENTS_PER_ROOM"
      label="elements"
      class="ws-toolbar__limit"
    />

    <div class="ws-toolbar__spacer" />

    <!-- Autosave indicator -->
    <AutosaveIndicator
      v-if="autosaveStatus && autosaveStatus !== 'idle'"
      :status="autosaveStatus"
      :last-saved-at="lastSavedAt"
      data-testid="autosave-indicator"
    />

    <!-- Member count chip -->
    <button class="ws-toolbar__member-chip" :title="`${memberCount} active members`" @click="emit('open-members')">
      👥 {{ memberCount }}
    </button>

    <!-- Pair peer -->
    <button
      class="ws-toolbar__action-btn"
      title="Connect a peer over LAN"
      data-testid="pair-btn"
      :disabled="disabled"
      @click="emit('open-pairing')"
    >
      Pair
    </button>

    <!-- Backup -->
    <button
      class="ws-toolbar__action-btn"
      title="Backup export / import"
      data-testid="backup-btn"
      @click="emit('open-backup')"
    >
      Backup
    </button>

    <!-- Snapshot / rollback -->
    <button
      v-if="canRollback"
      class="ws-toolbar__action-btn"
      title="Snapshots & rollback"
      @click="emit('open-snapshots')"
    >
      Snapshots
    </button>
  </div>
</template>

<style scoped>
.ws-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  overflow-x: auto;
}

.ws-toolbar__room-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #1e293b;
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.ws-toolbar__divider {
  width: 1px;
  height: 1.25rem;
  background: #e2e8f0;
  flex-shrink: 0;
}

.ws-toolbar__tools { display: flex; gap: 0.25rem; flex-shrink: 0; }

.ws-toolbar__tool {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  color: #475569;
  transition: all 0.1s;
}
.ws-toolbar__tool:hover:not(:disabled) { background: #e2e8f0; }
.ws-toolbar__tool--active { background: #2563eb; color: #fff; border-color: #2563eb; }
.ws-toolbar__tool:disabled { opacity: 0.4; cursor: not-allowed; }

.ws-toolbar__limit { max-width: 10rem; flex-shrink: 0; }
.ws-toolbar__spacer { flex: 1; }

.ws-toolbar__member-chip {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  color: #475569;
  flex-shrink: 0;
}
.ws-toolbar__member-chip:hover { background: #f1f5f9; }

.ws-toolbar__action-btn {
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  color: #475569;
  flex-shrink: 0;
}
.ws-toolbar__action-btn:hover { background: #e2e8f0; }
</style>
