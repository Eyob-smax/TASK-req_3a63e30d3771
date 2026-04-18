// REQ: R1 — Max 20 active members
// REQ: R3 — request→approval→active→leave state transitions
// REQ: R4 — Optional second Reviewer approval at 15+

import {
  MAX_ROOM_MEMBERS,
  SECOND_REVIEWER_THRESHOLD,
} from '@/models/constants'
import {
  MembershipState,
  VALID_MEMBERSHIP_TRANSITIONS,
} from '@/models/room'
import type { ValidationResult } from '@/models/validation'
import { validResult, invalidResult } from '@/models/validation'

/**
 * Validate that the room has not exceeded the maximum member count.
 * @param currentActiveCount Number of currently active (non-left, non-rejected) members.
 */
export function validateMemberCount(currentActiveCount: number): ValidationResult {
  if (currentActiveCount >= MAX_ROOM_MEMBERS) {
    return invalidResult(
      'memberCount',
      `Room has reached the maximum of ${MAX_ROOM_MEMBERS} active members.`,
      'max_count',
      currentActiveCount
    )
  }
  return validResult()
}

/**
 * Validate a membership state transition.
 * @param currentState The member's current state.
 * @param nextState The proposed next state.
 */
export function validateMembershipTransition(
  currentState: MembershipState,
  nextState: MembershipState
): ValidationResult {
  const allowed = VALID_MEMBERSHIP_TRANSITIONS[currentState]
  if (!allowed || !allowed.includes(nextState)) {
    return invalidResult(
      'membershipState',
      `Invalid transition from "${currentState}" to "${nextState}".`,
      'invalid_transition',
      { currentState, nextState }
    )
  }
  return validResult()
}

/**
 * Determine whether a second Reviewer approval is required for a join request.
 * @param currentActiveCount Number of currently active (non-left, non-rejected) members.
 * @param enableSecondReviewer Whether the room has second-reviewer mode enabled.
 */
export function requiresSecondApproval(
  currentActiveCount: number,
  enableSecondReviewer: boolean
): boolean {
  return enableSecondReviewer && currentActiveCount >= SECOND_REVIEWER_THRESHOLD
}

/**
 * Boolean convenience wrapper over validateMemberCanAct.
 * Returns true only when the member is currently Active.
 *
 * Use this for UI gating (computed props, disabled flags) so the same
 * rule drives both disabled UI and write-path enforcement and cannot drift.
 */
export function canMemberAct(memberState: MembershipState | undefined | null): boolean {
  if (!memberState) return false
  return validateMemberCanAct(memberState).valid
}

/**
 * Validate that a member in the "left" or "rejected" state cannot perform actions.
 * @param memberState The member's current state.
 */
export function validateMemberCanAct(memberState: MembershipState): ValidationResult {
  if (memberState === MembershipState.Left) {
    return invalidResult(
      'membershipState',
      'A member who has left the room cannot perform actions.',
      'invalid_transition',
      memberState
    )
  }
  if (memberState === MembershipState.Rejected) {
    return invalidResult(
      'membershipState',
      'A rejected member cannot perform actions.',
      'invalid_transition',
      memberState
    )
  }
  if (memberState === MembershipState.Requested) {
    return invalidResult(
      'membershipState',
      'A member with a pending request cannot perform room actions.',
      'invalid_transition',
      memberState
    )
  }
  if (memberState === MembershipState.PendingSecondApproval) {
    return invalidResult(
      'membershipState',
      'A member pending second approval cannot perform room actions.',
      'invalid_transition',
      memberState
    )
  }
  return validResult()
}

/**
 * Validate that a second approver is different from the first approver.
 * @param firstApproverId The memberId of the first approver.
 * @param secondApproverId The memberId of the proposed second approver.
 */
export function validateDistinctApprovers(
  firstApproverId: string,
  secondApproverId: string
): ValidationResult {
  if (firstApproverId === secondApproverId) {
    return invalidResult(
      'approverId',
      'The second approver must be a different person from the first approver.',
      'duplicate',
      { firstApproverId, secondApproverId }
    )
  }
  return validResult()
}
