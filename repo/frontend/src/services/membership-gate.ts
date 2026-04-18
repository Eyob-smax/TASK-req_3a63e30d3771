// REQ: R1/R3/R4 — Central membership-action gate used by UI stores before any write.
// Mirrors membership-engine.assertMemberCanAct but is placed in services so store
// modules can import without pulling the full engine surface.

import { memberRepository } from './member-repository'
import { validateMemberCanAct } from '@/validators/room-validators'
import {
  invalidResult,
  type ValidationResult,
} from '@/models/validation'

/**
 * Ensure that a member exists and is currently Active before performing a
 * write on their behalf. Returns an invalid ValidationResult with
 * code 'invalid_transition' when the member is missing, Left, Rejected,
 * Requested, or PendingSecondApproval.
 */
export async function ensureActiveMembership(
  roomId: string,
  memberId: string,
): Promise<ValidationResult> {
  const member = await memberRepository.find(roomId, memberId)
  if (!member) {
    return invalidResult(
      'membershipState',
      'No active membership for this room.',
      'invalid_transition',
      { roomId, memberId },
    )
  }
  return validateMemberCanAct(member.state)
}
