import { useState, useCallback, useEffect } from 'react';
import { AppState, RoutineTask, SystemMode, DayType, AutonomyLevel, TomorrowPlan, UserOverrideRecord } from '../types';
import { IExecutionRepository, defaultExecutionRepository } from '../repositories';
import { IClock, getClockForState } from '../clock';
import { ExecutionApplicationService } from './executionApplicationService';
import { ExecutionApiClient, defaultApiClient } from './apiClient';
import { ICommand, CommandResult, CompleteActivityPayload, AdjustActivityPayload, OverrideActivityPayload, ActivateDayPayload } from '../commands';

export function useExecutionApplication(
  initialRepository: IExecutionRepository = defaultExecutionRepository,
  customClock?: IClock,
  apiClient: ExecutionApiClient = defaultApiClient
) {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [appService] = useState(() => new ExecutionApplicationService(initialRepository, customClock));

  // Initial load from repository or API
  useEffect(() => {
    let mounted = true;
    initialRepository.loadState().then(loaded => {
      if (mounted) {
        setState(loaded);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [initialRepository]);

  const dispatchCommand = useCallback(
    async <TData = any>(command: ICommand<TData>): Promise<CommandResult<TData>> => {
      const res = await appService.dispatch(command, state || undefined);
      if (res.success && res.state) {
        setState(res.state);
      }
      return res;
    },
    [appService, state]
  );

  return {
    state,
    setState,
    loading,
    appService,
    dispatchCommand,
    planTomorrow: (plan: Partial<TomorrowPlan>) => appService.planTomorrow(plan, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    activateDay: (payload: ActivateDayPayload = {}) => appService.activateDay(payload, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    startActivity: (taskId: string) => appService.startActivity(taskId, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    pauseActivity: (taskId: string, reason?: string) => appService.pauseActivity(taskId, reason, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    resumeActivity: (taskId: string) => appService.resumeActivity(taskId, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    completeActivity: (payload: CompleteActivityPayload) => appService.completeActivity(payload, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    adjustActivity: (payload: AdjustActivityPayload) => appService.adjustActivity(payload, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    advanceActivity: (taskId: string, minutes: number, reason: string) => appService.advanceActivity(taskId, minutes, reason, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    deferActivity: (taskId: string, minutes: number, reason: string) => appService.deferActivity(taskId, minutes, reason, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    compressActivity: (taskId: string, duration: number, reason: string, tier?: number) => appService.compressActivity(taskId, duration, reason, tier, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    replaceActivity: (taskId: string, repId: string, reason: string) => appService.replaceActivity(taskId, repId, reason, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    overrideActivity: (payload: OverrideActivityPayload) => appService.overrideActivity(payload, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    recalculateDay: (force?: boolean, reason?: string) => appService.recalculateDay(force, reason, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    approveDecision: (decisionId: string, optionId: string) => appService.approveDecision(decisionId, optionId, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    rejectDecision: (decisionId: string, reason?: string) => appService.rejectDecision(decisionId, reason, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    pauseAutonomy: (reason?: string) => appService.pauseAutonomy(reason, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    resumeAutonomy: (level?: AutonomyLevel) => appService.resumeAutonomy(level, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    setSystemMode: (mode: SystemMode) => appService.setSystemMode(mode, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    setDayType: (dayType: DayType) => appService.setDayType(dayType, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    setSimulatedTime: (isSimulated: boolean, timeStr: string) => appService.setSimulatedTime(isSimulated, timeStr, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    acceptDisciplinePenalty: (taskId: string, points?: number) => appService.acceptDisciplinePenalty(taskId, points, state || undefined).then(r => { if (r.success) setState(r.state); return r; }),
    apiClient,
  };
}
