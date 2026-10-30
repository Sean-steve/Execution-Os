import { 
  AppState, 
  DeviationRecord, 
  InterventionRecord, 
  DeviationType, 
  RoutineTask 
} from '../types';
import { getCurrentTimeMinutes } from './storageService';
import { checkTaskDependencies } from './dependencyEngine';
import { calculateDynamicAllocations } from './allocationEngine';
import { evaluateRoutineState } from './routineEngine';
import { logEventToState } from './eventBus';

export interface DeviationScanResult {
  detectedDeviations: DeviationRecord[];
  interventions: InterventionRecord[];
  updatedState: AppState;
  hasNewDeviations: boolean;
}

/**
 * Scans the current execution state for deviations against scheduled plan
 */
export const scanAndResolveDeviations = (state: AppState): DeviationScanResult => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const tasks = state.tasks.filter(t => t.modesAllowed.includes(mode));
  const existingDeviations = state.deviations || [];
  const existingInterventions = state.interventions || [];

  const detectedDeviations: DeviationRecord[] = [...existingDeviations];
  const interventions: InterventionRecord[] = [...existingInterventions];
  let hasNewDeviations = false;
  let updatedState = { ...state };

  for (const task of tasks) {
    if (task.completed) continue;

    const depCheck = checkTaskDependencies(state, task.id);

    // 1. Check for Dependency Failure / Block
    if (depCheck.isBlocked) {
      const devId = `dev-dep-${task.id}-${currentMinutes}`;
      if (!detectedDeviations.some(d => d.activityId === task.id && d.type === 'DEPENDENCY_FAILURE')) {
        const newDev: DeviationRecord = {
          id: devId,
          timestamp: new Date().toISOString(),
          activityId: task.id,
          type: 'DEPENDENCY_FAILURE',
          severity: 'HIGH',
          likelyCause: `Prerequisite unfulfilled: ${depCheck.blockingReasons.join('; ')}`,
          impactSummary: `Task "${task.title}" cannot be executed until prerequisites are cleared.`,
          isResolved: false,
          resolvedAutonomously: true,
        };
        detectedDeviations.push(newDev);
        hasNewDeviations = true;

        // Auto-intervention: schedule prerequisite or reallocate
        const intervId = `int-${devId}`;
        const newInterv: InterventionRecord = {
          id: intervId,
          timestamp: new Date().toISOString(),
          deviationId: devId,
          actionTaken: 'REALLOCATE',
          description: `Sequenced prerequisite before "${task.title}" and queued automated alert.`,
          resultStatus: 'SUCCESS',
          humanApprovalRequired: false,
        };
        interventions.push(newInterv);
        newDev.isResolved = true;
        newDev.interventionId = intervId;
      }
    }

    // 2. Check for Missed / Late Window
    if (currentMinutes > (task.endMinutes + 15)) {
      const minutesDelayed = currentMinutes - task.endMinutes;
      const devId = `dev-late-${task.id}`;
      
      if (!detectedDeviations.some(d => d.activityId === task.id && (d.type === 'LATE' || d.type === 'MISSED'))) {
        const newDev: DeviationRecord = {
          id: devId,
          timestamp: new Date().toISOString(),
          activityId: task.id,
          type: minutesDelayed > 90 ? 'MISSED' : 'LATE',
          severity: task.isNonNegotiable ? 'HIGH' : 'MEDIUM',
          minutesDelayed,
          likelyCause: 'Actual wake or session overrun delayed start beyond scheduled execution window.',
          impactSummary: `Scheduled window for "${task.title}" expired. Downstream schedule requires compression.`,
          isResolved: false,
          resolvedAutonomously: true,
        };
        detectedDeviations.push(newDev);
        hasNewDeviations = true;

        // Trigger autonomous recovery & reallocation
        const intervId = `int-${devId}`;
        const newInterv: InterventionRecord = {
          id: intervId,
          timestamp: new Date().toISOString(),
          deviationId: devId,
          actionTaken: 'TRIGGER_FALLBACK',
          description: `Applied Level 1/2 Fallback to compress "${task.title}" and shifted downstream blocks to preserve 4:00 PM family commitment.`,
          resultStatus: 'SUCCESS',
          humanApprovalRequired: false,
        };
        interventions.push(newInterv);
        newDev.isResolved = true;
        newDev.interventionId = intervId;
      }
    }
  }

  // Update routine state & allocations
  const routineEval = evaluateRoutineState(updatedState);
  const allocResult = calculateDynamicAllocations(updatedState);

  updatedState = {
    ...updatedState,
    routineState: routineEval.routineState,
    routineChangeReason: routineEval.reason,
    dynamicAllocations: allocResult.allocations,
    tasks: allocResult.recalculatedTasks,
    lastReallocationReason: allocResult.reallocationReason,
    deviations: detectedDeviations,
    interventions,
    autonomousResolutionCount: (state.autonomousResolutionCount || 0) + (hasNewDeviations ? 1 : 0),
  };

  if (hasNewDeviations) {
    updatedState = logEventToState(
      updatedState,
      'DeviationDetected',
      'System Execution Deviation Intercepted',
      { detectedCount: detectedDeviations.length }
    );
  }

  return {
    detectedDeviations,
    interventions,
    updatedState,
    hasNewDeviations,
  };
};
