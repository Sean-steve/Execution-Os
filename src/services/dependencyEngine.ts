import { AppState, RoutineTask, ActivityDependency, DependencyType } from '../types';
import { evaluateExternalExecutionGates } from './externalExecutionGate';

export interface DependencyCheckResult {
  isBlocked: boolean;
  isSatisfied: boolean;
  blockingReasons: string[];
  blockingTaskIds: string[];
  dependencyType?: DependencyType;
}

/**
 * Checks all active dependencies for a given task
 */
export const checkTaskDependencies = (
  state: AppState,
  taskId: string
): DependencyCheckResult => {
  const dependencies = state.dependencies || [];
  const task = state.tasks.find(t => t.id === taskId);
  const activity = state.activities?.find(a => a.id === taskId);
  
  if (!task && !activity) {
    return { isBlocked: false, isSatisfied: true, blockingReasons: [], blockingTaskIds: [] };
  }

  const blockingReasons: string[] = [];
  const blockingTaskIds: string[] = [];

  // Domain-neutral boundary: external engines express policy as execution gates.
  const externalGateCheck = evaluateExternalExecutionGates(state, taskId);
  if (externalGateCheck.isBlocked) {
    blockingReasons.push(...externalGateCheck.blockingReasons);
    blockingTaskIds.push(...externalGateCheck.gateIds.map(id => `external-gate:${id}`));
  }

  // Check defined dependencies
  const inboundDeps = dependencies.filter(d => d.targetActivityId === taskId);

  for (const dep of inboundDeps) {
    const sourceTask = state.tasks.find(t => t.id === dep.sourceActivityId);
    
    if (dep.type === 'REQUIRES' || dep.type === 'BLOCKS') {
      if (sourceTask && !sourceTask.completed) {
        blockingReasons.push(`Requires prior completion of "${sourceTask.title}": ${dep.description}`);
        blockingTaskIds.push(sourceTask.id);
      }
    } else if (dep.type === 'SEQUENCE') {
      if (sourceTask && !sourceTask.completed) {
        blockingReasons.push(`Strict sequence: "${sourceTask.title}" must be completed first.`);
        blockingTaskIds.push(sourceTask.id);
      }
    }
  }

  const isBlocked = blockingReasons.length > 0;
  return {
    isBlocked,
    isSatisfied: !isBlocked,
    blockingReasons,
    blockingTaskIds,
  };
};

/**
 * Returns all downstream tasks affected if a given task is missed or delayed
 */
export const getDownstreamAffectedTasks = (
  state: AppState,
  sourceTaskId: string
): RoutineTask[] => {
  const dependencies = state.dependencies || [];
  const outboundDeps = dependencies.filter(d => d.sourceActivityId === sourceTaskId);
  const targetIds = outboundDeps.map(d => d.targetActivityId);
  return state.tasks.filter(t => targetIds.includes(t.id));
};
