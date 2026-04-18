// REQ: R5/R6 — Thin harness exposing element + image engines to UI
// REQ: R1/R3/R4 — Write paths block non-Active members via ensureActiveMembership

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WhiteboardElement } from '@/models/element'
import * as elementEngine from '@/engine/element-engine'
import * as imageEngine from '@/engine/image-engine'
import { publishElement, publishConflict } from '@/services/collab-publisher'
import { getLocalTabId } from '@/services/broadcast-channel-service'
import { ensureActiveMembership } from '@/services/membership-gate'
import { elementRepository } from '@/services/element-repository'
import { invalidResult } from '@/models/validation'
import { logger } from '@/utils/logger'

export const useElementStore = defineStore('element', () => {
  const elements = ref<WhiteboardElement[]>([])
  const isLoading = ref(false)
  const lastError = ref<string | null>(null)

  async function loadElements(roomId: string): Promise<void> {
    isLoading.value = true
    lastError.value = null
    try {
      elements.value = await elementEngine.listElements(roomId)
    } catch (err) {
      logger.error('Failed to load elements', { roomId, err })
      lastError.value = 'Failed to load elements.'
    } finally {
      isLoading.value = false
    }
  }

  async function createSticky(input: elementEngine.CreateStickyInput) {
    const gate = await ensureActiveMembership(input.roomId, input.actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await elementEngine.createSticky(input)
    if (result.element) {
      elements.value.push(result.element)
      publishElement(
        input.roomId,
        'create',
        result.element.elementId,
        input.actor.memberId,
        result.element
      )
    }
    return result
  }

  async function createArrow(input: elementEngine.CreateArrowInput) {
    const gate = await ensureActiveMembership(input.roomId, input.actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await elementEngine.createArrow(input)
    if (result.element) {
      elements.value.push(result.element)
      publishElement(
        input.roomId,
        'create',
        result.element.elementId,
        input.actor.memberId,
        result.element
      )
    }
    return result
  }

  async function createPenStroke(input: elementEngine.CreatePenStrokeInput) {
    const gate = await ensureActiveMembership(input.roomId, input.actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await elementEngine.createPenStroke(input)
    if (result.element) {
      elements.value.push(result.element)
      publishElement(
        input.roomId,
        'create',
        result.element.elementId,
        input.actor.memberId,
        result.element
      )
    }
    return result
  }

  async function ingestImage(input: imageEngine.IngestImageInput) {
    const gate = await ensureActiveMembership(input.roomId, input.actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await imageEngine.ingestImageFile(input)
    if (result.element) {
      elements.value.push(result.element)
      publishElement(
        input.roomId,
        'create',
        result.element.elementId,
        input.actor.memberId,
        result.element
      )
    }
    return result
  }

  async function updateElement(
    elementId: string,
    patch: Parameters<typeof elementEngine.updateElement>[1],
    actor: Parameters<typeof elementEngine.updateElement>[2]
  ) {
    const local = elements.value.find((e) => e.elementId === elementId)
    const target = local ?? (await elementRepository.getById(elementId))
    if (!target) {
      return {
        validation: invalidResult('elementId', 'Element not found.', 'not_found', elementId),
      }
    }
    const gate = await ensureActiveMembership(target.roomId, actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await elementEngine.updateElement(elementId, patch, actor)
    if (result.element) {
      const idx = elements.value.findIndex((e) => e.elementId === elementId)
      if (idx !== -1) elements.value.splice(idx, 1, result.element)
      publishElement(
        result.element.roomId,
        'update',
        result.element.elementId,
        actor.memberId,
        result.element
      )
    } else if (!result.validation.valid && local) {
      // Target element disappeared between our read and this write —
      // treat as an element-overwrite conflict so peers / other tabs can notice.
      publishConflict(
        local.roomId,
        'element-overwrite',
        elementId,
        getLocalTabId(),
        result.validation.errors[0]?.message ?? 'Element was modified by another writer.',
        actor.memberId,
      )
    }
    return result
  }

  async function deleteElement(
    elementId: string,
    actor: Parameters<typeof elementEngine.deleteElement>[1]
  ) {
    const existing = elements.value.find((e) => e.elementId === elementId)
    const target = existing ?? (await elementRepository.getById(elementId))
    if (!target) {
      return {
        validation: invalidResult('elementId', 'Element not found.', 'not_found', elementId),
      }
    }
    const gate = await ensureActiveMembership(target.roomId, actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await elementEngine.deleteElement(elementId, actor)
    if (result.validation.valid) {
      elements.value = elements.value.filter((e) => e.elementId !== elementId)
      if (existing) {
        publishElement(existing.roomId, 'delete', elementId, actor.memberId, existing)
      }
    }
    return result
  }

  async function bringToFront(
    elementId: string,
    actor: Parameters<typeof elementEngine.bringToFront>[1]
  ) {
    const existing = elements.value.find((e) => e.elementId === elementId)
    const target = existing ?? (await elementRepository.getById(elementId))
    if (!target) {
      return {
        validation: invalidResult('elementId', 'Element not found.', 'not_found', elementId),
      }
    }
    const gate = await ensureActiveMembership(target.roomId, actor.memberId)
    if (!gate.valid) return { validation: gate }
    const result = await elementEngine.bringToFront(elementId, actor)
    if (result.element) {
      const idx = elements.value.findIndex((e) => e.elementId === elementId)
      if (idx !== -1) elements.value.splice(idx, 1, result.element)
      publishElement(
        result.element.roomId,
        'update',
        result.element.elementId,
        actor.memberId,
        result.element
      )
    }
    return result
  }

  return {
    elements,
    isLoading,
    lastError,
    loadElements,
    createSticky,
    createArrow,
    createPenStroke,
    ingestImage,
    updateElement,
    deleteElement,
    bringToFront,
  }
})
