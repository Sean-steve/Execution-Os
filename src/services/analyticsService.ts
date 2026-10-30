import { AppState, ExecutionAnalytics } from '../types';

export const computeExecutionAnalytics = (state: AppState): ExecutionAnalytics => {
  const tasks = state.tasks || [];
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;
  const onTimeTasks = tasks.filter(t => t.completed && t.executionStatus === 'ON_TIME').length;
  const fallbackTasks = tasks.filter(t => (t.fallbackLevel || 0) > 0).length;
  
  const deviations = state.deviations || [];
  const totalDeviations = deviations.length;
  const resolvedDeviations = deviations.filter(d => d.isResolved || d.resolvedAutonomously).length;

  const overrides = state.userOverrides || [];
  const interventions = state.interventions || [];

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const onTimeRate = completedTasks > 0 ? Math.round((onTimeTasks / completedTasks) * 100) : 100;
  const fallbackRate = completedTasks > 0 ? Math.round((fallbackTasks / completedTasks) * 100) : 0;
  
  const autonomousResolutionRate = totalDeviations > 0 
    ? Math.round((resolvedDeviations / totalDeviations) * 100)
    : 100;

  const recoveryRate = totalDeviations > 0
    ? Math.round((resolvedDeviations / totalDeviations) * 100)
    : 100;

  const interventionRate = totalTasks > 0
    ? Math.round((interventions.length / totalTasks) * 100)
    : 0;

  const overrideRate = totalTasks > 0
    ? Math.round((overrides.length / totalTasks) * 100)
    : 0;

  return {
    completionRate,
    onTimeRate,
    recoveryRate,
    fallbackRate,
    interventionRate,
    overrideRate,
    autonomousResolutionRate,
    totalDeviations,
    resolvedDeviations,
  };
};
