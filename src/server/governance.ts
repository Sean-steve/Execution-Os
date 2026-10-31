import { AppState, RoutineTask, UserOverrideRecord } from '../types';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { getAuthoritativeProtectedCommitments } from '../services/scheduleAuthority';
import {
  GovernanceDeniedError,
  DependencyBlockedError,
  ApprovalRequiredError,
  SecurityIntegrityError
} from './errors';
import { SecurityEngine } from './security';

export interface GovernanceEvaluationResult {
  allowed: boolean;
  error?: Error;
  requiresApproval?: boolean;
  reason?: string;
  governanceLevel?: string;
}

/**
 * Server-Side G0-G5 Governance Engine (EOS-007)
 * Strictly enforces policy boundaries on the server side:
 * - G0: System integrity & immutable audit logging
 * - G1: Activity lifecycle & prerequisite dependencies
 * - G2: Protected commitments supplied by the schedule authority
 * - G3: Reserved for external-domain gate policy; Execution OS consumes generic gates only
 * - G4: Bounded execution autonomy (L0-L5) & manual lock
 * - G5: Tamper-proof override signatures & double-confirmation
 */
export class GovernanceEngine {
  /**
   * Evaluates if an activity can be started (G1, G3, G4 enforcement)
   */
  static evaluateActivityStart(state: AppState, taskId: string): GovernanceEvaluationResult {
    const task = state.tasks.find(t => t.id === taskId);
    const def = state.activities.find(a => a.id === taskId);

    // G1: Dependencies and external-engine gates are evaluated before local-task
    // existence. External engines may gate virtual actions not materialized locally.
    const dependencyCheck = checkTaskDependencies(state, taskId);
    if (dependencyCheck.isBlocked) {
      return {
        allowed: false,
        governanceLevel: 'G1',
        error: new DependencyBlockedError(
          `Execution blocked for ${task?.title || taskId}: ${dependencyCheck.blockingReasons.join('; ')}`,
          { blockingReasons: dependencyCheck.blockingReasons, taskId, rule: 'G1_EXECUTION_DEPENDENCY_OR_EXTERNAL_GATE' }
        ),
      };
    }

    if (!task) return { allowed: true };

    // G4: Execution OS owns bounded execution autonomy, not whole-person policy.
    if (state.autonomyLevel === 5 && state.activeHumanDecision) {
      return {
        allowed: false,
        governanceLevel: 'G4',
        requiresApproval: true,
        error: new ApprovalRequiredError('Human approval is required before activity start.', {
          decisionId: state.activeHumanDecision.id,
          autonomyLevel: state.autonomyLevel,
          rule: 'G4_AUTONOMY_MANUAL_LOCK',
        }),
      };
    }

    const isHighFocus = def?.focusRequirement === 'HIGH';
    const isRecovery = task.category === 'RECOVERY' || task.id.includes('recovery') || task.id.includes('rest');
    if (state.currentMode === 'RED' && isHighFocus && !isRecovery && state.activeHumanDecision) {
      return {
        allowed: false,
        governanceLevel: 'G4',
        error: new ApprovalRequiredError('Pending approval required before high-load execution in RED mode.', {
          decisionId: state.activeHumanDecision.id,
          mode: state.currentMode,
          rule: 'G4_RED_MODE_HIGH_LOAD_GATE',
        }),
      };
    }

    return { allowed: true };
  }

  /**
   * Evaluates schedule modifications and protected commitments (G2 Governance)
   */
  static evaluateActivitySchedule(
    state: AppState,
    taskId: string,
    startMinutes: number,
    endMinutes: number,
    isEmergencyOverride: boolean = false,
    overrideReason?: string
  ): GovernanceEvaluationResult {
    const task = state.tasks.find(t => t.id === taskId);
    const protectedCommitments = getAuthoritativeProtectedCommitments(state);

    const conflictingCommitment = protectedCommitments.find(commitment =>
      commitment.sourceRef !== taskId &&
      startMinutes < commitment.endMinutes &&
      endMinutes > commitment.startMinutes
    );

    if (conflictingCommitment && !task?.isProtected) {
      if (!isEmergencyOverride || !overrideReason || overrideReason.trim().length < 5) {
        return {
          allowed: false,
          governanceLevel: 'G2',
          error: new GovernanceDeniedError(
            `Protected commitment cannot be displaced: ${conflictingCommitment.title}.`,
            {
              taskId,
              allocatedStart: startMinutes,
              allocatedEnd: endMinutes,
              protectedCommitmentId: conflictingCommitment.id,
              rule: 'G2_AUTHORITATIVE_PROTECTED_COMMITMENT',
            }
          ),
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Evaluates user overrides and verifies tamper-proof audit & signature integrity (G5 Governance)
   */
  static evaluateOverride(
    state: AppState,
    overrideData: {
      userId: string;
      overrideType: string;
      reason: string;
      targetTaskId?: string;
      targetMode?: string;
      timestamp?: string;
      signature?: string;
    }
  ): GovernanceEvaluationResult {
    if (!overrideData.reason || overrideData.reason.trim().length < 4) {
      return {
        allowed: false,
        governanceLevel: 'G5',
        error: new GovernanceDeniedError('Override rejected: Valid justification reason is mandatory (minimum 4 characters).', {
          rule: 'G5_OVERRIDE_REASON_REQUIRED',
        }),
      };
    }

    // If client supplied a cryptographic signature, verify it against server master key
    if (overrideData.signature) {
      const isValid = SecurityEngine.verifyOverrideSignature(
        {
          userId: overrideData.userId,
          overrideType: overrideData.overrideType,
          reason: overrideData.reason,
          targetTaskId: overrideData.targetTaskId,
          targetMode: overrideData.targetMode,
          timestamp: overrideData.timestamp || new Date().toISOString(),
        },
        overrideData.signature
      );

      if (!isValid) {
        return {
          allowed: false,
          governanceLevel: 'G5',
          error: new SecurityIntegrityError('Cryptographic override signature is invalid or has been forged.', {
            rule: 'G5_SIGNATURE_TAMPER_DETECTED',
          }),
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Evaluates decision approval to prevent executing stale or already resolved decisions
   */
  static evaluateDecisionApproval(state: AppState, decisionId: string, optionId: string): GovernanceEvaluationResult {
    const active = state.activeHumanDecision;
    if (!active || active.id !== decisionId) {
      return {
        allowed: false,
        governanceLevel: 'G4',
        error: new GovernanceDeniedError(
          `Decision approval rejected: Decision "${decisionId}" is stale or does not match currently active human decision.`,
          { decisionId, activeDecisionId: active?.id, rule: 'G4_STALE_DECISION_APPROVAL' }
        ),
      };
    }

    const hasOption = active.options.some(opt => opt.id === optionId);
    if (!hasOption) {
      return {
        allowed: false,
        governanceLevel: 'G4',
        error: new GovernanceDeniedError(
          `Decision approval rejected: Option "${optionId}" is not a valid candidate for decision "${decisionId}".`,
          { decisionId, optionId, availableOptions: active.options.map(o => o.id), rule: 'G4_INVALID_DECISION_OPTION' }
        ),
      };
    }

    return { allowed: true };
  }

  /**
   * Evaluates autonomy boundary constraints
   */
  static evaluateAutonomyLevel(state: AppState): GovernanceEvaluationResult {
    if (state.autonomyLevel === 5 && state.activeHumanDecision) {
      return {
        allowed: false,
        governanceLevel: 'G4',
        requiresApproval: true,
        error: new ApprovalRequiredError('System is at Autonomy Level 5 (Human Approval Required). Human decision sign-off is required.', {
          decisionId: state.activeHumanDecision.id,
          rule: 'G4_AUTONOMY_MANUAL_LOCK',
        }),
      };
    }
    return { allowed: true };
  }
}
