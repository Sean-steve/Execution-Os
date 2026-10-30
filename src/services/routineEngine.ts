import { AppState, RoutineState, SystemMode, DayType } from '../types';
import { getCurrentTimeMinutes } from './storageService';

export interface RoutineEvaluationResult {
  routineState: RoutineState;
  reason: string;
  isCompressed: boolean;
  canExecuteAutonomousRecovery: boolean;
}

/**
 * Routine Engine
 * Evaluates the current operational state of the daily routine and why it is in that state.
 */
export const evaluateRoutineState = (state: AppState): RoutineEvaluationResult => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const mode = state.currentMode;
  const dayType = state.dayType;
  const tasks = state.tasks || [];
  const allowedTasks = tasks.filter(t => t.modesAllowed.includes(mode));

  const allCompleted = allowedTasks.length > 0 && allowedTasks.every(t => t.completed);
  if (allCompleted) {
    return {
      routineState: 'COMPLETED',
      reason: 'All scheduled anchors for today have been executed successfully.',
      isCompressed: false,
      canExecuteAutonomousRecovery: false,
    };
  }

  if (mode === 'RED') {
    return {
      routineState: 'RECOVERY',
      reason: 'Red Mode Active: Full routine suspended; executing minimum recovery protocol and vital survival anchors.',
      isCompressed: true,
      canExecuteAutonomousRecovery: true,
    };
  }

  if (dayType === 'EARLY_DEPARTURE') {
    return {
      routineState: 'EARLY_EXIT',
      reason: 'Early Exit Day: Morning prime compressed for early 9:00 AM departure envelope.',
      isCompressed: true,
      canExecuteAutonomousRecovery: true,
    };
  }

  if (mode === 'YELLOW') {
    return {
      routineState: 'DISRUPTED',
      reason: 'Yellow Mode Active: Minimum Viable Routine (MVR) engaged to maintain core discipline through disruption.',
      isCompressed: true,
      canExecuteAutonomousRecovery: true,
    };
  }

  // Check if current time has severely drifted past morning anchors
  const uncompletedPastScheduled = allowedTasks.filter(
    t => !t.completed && (currentMinutes > t.endMinutes + 30)
  );

  if (uncompletedPastScheduled.length >= 2 || (currentMinutes > 480 && allowedTasks.filter(t => t.startMinutes < 480 && !t.completed).length >= 2)) {
    const minStart = Math.min(...uncompletedPastScheduled.map(t => t.startMinutes));
    const driftMinutes = currentMinutes - minStart;
    return {
      routineState: 'COMPRESSED',
      reason: `Schedule Drift of ${driftMinutes}m detected. Routine transitioned from STANDARD to COMPRESSED to protect Deep Work Build and the 4:00 PM Family block.`,
      isCompressed: true,
      canExecuteAutonomousRecovery: true,
    };
  }

  return {
    routineState: 'STANDARD',
    reason: 'Nominal operating conditions. All non-negotiable and flexible anchors active in optimal sequence.',
    isCompressed: false,
    canExecuteAutonomousRecovery: false,
  };
};
