import { AppState, RoutineTask, UserOverrideRecord } from '../types';
import { checkTaskDependencies } from '../services/dependencyEngine';
import {
  GovernanceDeniedError,
  TradingGateClosedError,
  DependencyBlockedError,
  ApprovalRequiredError,
  SecurityIntegrityError
} from './errors';
import { SecurityEngine } from './security';
import { domainExecutionPolicies } from '../domainPolicies';
import { getProtectedScheduleWindows } from '../services/scheduleAuthorityService';

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
 * - G2: Protected commitments supplied by user/HOS policy
 * - DOMAIN: Domain-specific execution gates supplied through adapters
 * - G4: Autonomy boundaries (L0-L5) & manual lock
 * - G5: Tamper-proof override signatures & double-confirmation
 */
export class GovernanceEngine {
  /**
   * Evaluates if an activity can be started (G1, G3, G4 enforcement)
   */
  static evaluateActivityStart(state: AppState, taskId: string): GovernanceEvaluationResult {
    // 1. Domain policy adapters may deny execution without coupling the kernel to a domain.
    for (const result of domainExecutionPolicies.evaluateStart(state, taskId)) {
      if (!result.blocked) continue;
      return {
        allowed: false,
        governanceLevel: 'DOMAIN',
        error: result.errorCode === 'TRADING_GATE_CLOSED'
          ? new TradingGateClosedError(result.reasons.join('; '), { taskId, rule: result.rule })
          : new GovernanceDeniedError(result.reasons.join('; '), { taskId, rule: result.rule }),
      };
    }


    const task = state.tasks.find(t => t.id === taskId);
    const def = state.activities.find(a => a.id === taskId);
    if (!task) return { allowed: true };

    // 2. Generic Task Dependency check (G1 Governance)
    const generalDepCheck = checkTaskDependencies(state, taskId);
    if (generalDepCheck.isBlocked) {
      return {
        allowed: false,
        governanceLevel: 'G1',
        error: new DependencyBlockedError(
          `Dependencies not met for activity ${task.title}: ${generalDepCheck.blockingReasons.join('; ')}`,
          { blockingReasons: generalDepCheck.blockingReasons, taskId, rule: 'G1_DEPENDENCY_RULE' }
        ),
      };
    }

    // 3. Autonomy Manual / Red Mode check (G4 Governance)
    if (state.autonomyLevel === 5 && state.activeHumanDecision) {
      return {
        allowed: false,
        governanceLevel: 'G4',
        requiresApproval: true,
        error: new ApprovalRequiredError('System is in Autonomy Level 5 (MANUAL / Human Approval Required). Decision must be approved before activity start.', {
          decisionId: state.activeHumanDecision.id,
          autonomyLevel: state.autonomyLevel,
          rule: 'G4_AUTONOMY_MANUAL_LOCK',
        }),
      };
    }

    const isHighFocus = def?.focusRequirement === 'HIGH';
    const isRecovery = taskId.includes('recovery') || taskId.includes('rest');
    if (state.currentMode === 'RED' && isHighFocus && !isRecovery) {
      if (state.activeHumanDecision) {
        return {
          allowed: false,
          governanceLevel: 'G4',
          error: new ApprovalRequiredError('Pending decision approval required before executing high-load task in RED mode', {
            decisionId: state.activeHumanDecision.id,
            mode: state.currentMode,
            rule: 'G4_RED_MODE_HIGH_LOAD_GATE',
          }),
        };
      }
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

    const protectedWindows = getProtectedScheduleWindows(state);
    const ownWindowIds = new Set([taskId, `task-window-${taskId}`]);
    const conflict = protectedWindows.find(window =>
      !ownWindowIds.has(window.id) &&
      startMinutes < window.endMinutes &&
      endMinutes > window.startMinutes
    );

    if (conflict) {
      if (!isEmergencyOverride || !overrideReason || overrideReason.trim().length < 5) {
        return {
          allowed: false,
          governanceLevel: 'G2',
          error: new GovernanceDeniedError(
            `Protected Commitment Violation: "${task?.title || taskId}" cannot overlap "${conflict.label || conflict.id}" without an explicit governed override.`,
            {
              taskId,
              allocatedStart: startMinutes,
              allocatedEnd: endMinutes,
              protectedWindowId: conflict.id,
              protectedStart: conflict.startMinutes,
              protectedEnd: conflict.endMinutes,
              source: conflict.source,
              rule: 'G2_PROTECTED_COMMITMENT_DISPLACEMENT',
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
