import {
  AppState,
  DynamicAllocation,
  HOSDailyOperatingPlan,
  RoutineTask,
  ScheduleProposal,
} from '../types';

export interface ScheduleAuthorityDecision {
  state: AppState;
  applied: boolean;
  proposal?: ScheduleProposal;
  reason: string;
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

export function isHosScheduleAuthoritative(state: AppState): boolean {
  return state.scheduleAuthority?.mode === 'HOS' && Boolean(state.scheduleAuthority.authoritativePlan);
}

export function getAuthoritativeProtectedCommitments(state: AppState) {
  if (isHosScheduleAuthoritative(state)) {
    return (state.scheduleAuthority!.authoritativePlan!.commitments || []).filter(c => c.isProtected);
  }

  // Standalone compatibility: only explicitly protected tasks are authoritative.
  return state.tasks
    .filter(task => task.isProtected)
    .map(task => ({
      id: `task-protected-${task.id}`,
      title: task.title,
      startMinutes: task.allocatedStartMinutes ?? task.startMinutes,
      endMinutes: task.allocatedEndMinutes ?? task.endMinutes,
      isProtected: true,
      source: 'EXTERNAL' as const,
      sourceRef: task.id,
    }));
}

function windowAllowsTask(window: any, task: RoutineTask) {
  if (window.allowedActivityIds?.length && !window.allowedActivityIds.includes(task.id)) return false;
  if (window.allowedCategories?.length && (!task.category || !window.allowedCategories.includes(task.category))) return false;
  return true;
}

export function isScheduleChangeWithinDelegation(
  state: AppState,
  task: RoutineTask,
  startMinutes: number,
  endMinutes: number,
  operation: 'REALLOCATE' | 'COMPRESS' | 'DEFER' = 'REALLOCATE'
): boolean {
  if (!isHosScheduleAuthoritative(state)) return true;

  const plan = state.scheduleAuthority!.authoritativePlan!;
  const protectedConflict = (plan.commitments || []).some(commitment =>
    commitment.isProtected &&
    !task.isProtected &&
    overlaps(startMinutes, endMinutes, commitment.startMinutes, commitment.endMinutes)
  );
  if (protectedConflict) return false;

  const allowed = (plan.delegatedWindows || []).some(window => {
    if (!windowAllowsTask(window, task)) return false;
    if (startMinutes < window.startMinutes || endMinutes > window.endMinutes) return false;
    if (operation === 'COMPRESS' && !window.canCompress) return false;
    if (operation === 'DEFER' && !window.canDefer) return false;
    if (operation === 'REALLOCATE' && !window.canReallocate) return false;
    return true;
  });

  return allowed;
}

function createProposal(
  state: AppState,
  allocations: DynamicAllocation[],
  reason: string,
  status: ScheduleProposal['status']
): ScheduleProposal {
  const plan = state.scheduleAuthority?.authoritativePlan;
  return {
    id: `schedule-proposal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    source: 'EXECUTION_OS',
    authority: 'HOS',
    planId: plan?.planId,
    planVersion: plan?.planVersion,
    reason,
    allocations,
    status,
    createdAtUtc: new Date().toISOString(),
    resolvedAtUtc: status === 'AUTO_APPLIED_WITHIN_DELEGATION' ? new Date().toISOString() : undefined,
  };
}

export function reconcileAllocationPlanWithAuthority(
  state: AppState,
  allocations: DynamicAllocation[],
  recalculatedTasks: RoutineTask[],
  reason: string
): ScheduleAuthorityDecision {
  if (!isHosScheduleAuthoritative(state)) {
    return {
      state: { ...state, dynamicAllocations: allocations, tasks: recalculatedTasks },
      applied: true,
      reason: 'Standalone schedule authority: allocation applied locally.',
    };
  }

  const allWithinDelegation = allocations.every(allocation => {
    const task = state.tasks.find(t => t.id === allocation.activityId);
    if (!task || task.completed || task.isProtected) return true;
    const originalDuration = Math.max(0, allocation.originalEndMinutes - allocation.originalStartMinutes);
    const operation =
      allocation.durationMinutes < originalDuration ? 'COMPRESS'
        : allocation.allocatedStartMinutes > allocation.originalStartMinutes ? 'DEFER'
        : 'REALLOCATE';
    return isScheduleChangeWithinDelegation(
      state,
      task,
      allocation.allocatedStartMinutes,
      allocation.allocatedEndMinutes,
      operation
    );
  });

  const proposal = createProposal(
    state,
    allocations,
    reason,
    allWithinDelegation ? 'AUTO_APPLIED_WITHIN_DELEGATION' : 'PROPOSED'
  );

  if (!allWithinDelegation) {
    return {
      state: {
        ...state,
        scheduleProposals: [proposal, ...(state.scheduleProposals || [])],
      },
      applied: false,
      proposal,
      reason: 'HOS is authoritative: proposed allocation leaves delegated execution boundaries and was not applied.',
    };
  }

  return {
    state: {
      ...state,
      dynamicAllocations: allocations,
      tasks: recalculatedTasks,
      scheduleProposals: [proposal, ...(state.scheduleProposals || [])],
    },
    applied: true,
    proposal,
    reason: 'Allocation auto-applied because every change remained inside HOS-delegated boundaries.',
  };
}

export function requestSingleActivityScheduleChange(
  state: AppState,
  taskId: string,
  startMinutes: number,
  endMinutes: number,
  reason: string,
  operation: 'REALLOCATE' | 'COMPRESS' | 'DEFER' = 'REALLOCATE'
): ScheduleAuthorityDecision {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return { state, applied: false, reason: `Activity ${taskId} not found.` };

  const protectedConflict = getAuthoritativeProtectedCommitments(state).find(commitment =>
    commitment.sourceRef !== taskId &&
    !task.isProtected &&
    overlaps(startMinutes, endMinutes, commitment.startMinutes, commitment.endMinutes)
  );
  if (protectedConflict) {
    if (isHosScheduleAuthoritative(state)) {
      const proposedAllocation: DynamicAllocation = {
        activityId: task.id,
        instanceId: `inst-${task.id}`,
        title: task.title,
        originalStartMinutes: task.startMinutes,
        originalEndMinutes: task.endMinutes,
        allocatedStartMinutes: startMinutes,
        allocatedEndMinutes: endMinutes,
        durationMinutes: endMinutes - startMinutes,
        isCompressed: (endMinutes - startMinutes) < (task.endMinutes - task.startMinutes),
        isFallback: (task.fallbackLevel || 0) > 0,
        fallbackLevel: task.fallbackLevel || 0,
        isProtected: Boolean(task.isProtected),
        priority: task.isNonNegotiable ? 5 : 3,
        reasonForAdjustment: reason,
        dependencyStatus: 'SATISFIED',
      };
      const proposal = createProposal(
        state,
        [proposedAllocation],
        `${reason} Conflicts with protected commitment "${protectedConflict.title}".`,
        'PROPOSED'
      );
      return {
        state: { ...state, scheduleProposals: [proposal, ...(state.scheduleProposals || [])] },
        applied: false,
        proposal,
        reason: `HOS authority retained: proposed change conflicts with protected commitment "${protectedConflict.title}".`,
      };
    }
    return {
      state,
      applied: false,
      reason: `Protected commitment cannot be displaced: "${protectedConflict.title}".`,
    };
  }

  const allocation: DynamicAllocation = {
    activityId: task.id,
    instanceId: `inst-${task.id}`,
    title: task.title,
    originalStartMinutes: task.startMinutes,
    originalEndMinutes: task.endMinutes,
    allocatedStartMinutes: startMinutes,
    allocatedEndMinutes: endMinutes,
    durationMinutes: endMinutes - startMinutes,
    isCompressed: (endMinutes - startMinutes) < (task.endMinutes - task.startMinutes),
    isFallback: (task.fallbackLevel || 0) > 0,
    fallbackLevel: task.fallbackLevel || 0,
    isProtected: Boolean(task.isProtected),
    priority: task.isNonNegotiable ? 5 : 3,
    reasonForAdjustment: reason,
    dependencyStatus: 'SATISFIED',
  };

  if (isHosScheduleAuthoritative(state) && !isScheduleChangeWithinDelegation(state, task, startMinutes, endMinutes, operation)) {
    const proposal = createProposal(state, [allocation], reason, 'PROPOSED');
    return {
      state: { ...state, scheduleProposals: [proposal, ...(state.scheduleProposals || [])] },
      applied: false,
      proposal,
      reason: 'HOS authority retained: change recorded as a proposal, not applied.',
    };
  }

  const updatedTasks = state.tasks.map(t => t.id === taskId
    ? { ...t, allocatedStartMinutes: startMinutes, allocatedEndMinutes: endMinutes }
    : t
  );
  const proposal = isHosScheduleAuthoritative(state)
    ? createProposal(state, [allocation], reason, 'AUTO_APPLIED_WITHIN_DELEGATION')
    : undefined;

  return {
    state: {
      ...state,
      tasks: updatedTasks,
      dynamicAllocations: [
        ...(state.dynamicAllocations || []).filter(a => a.activityId !== taskId),
        allocation,
      ],
      scheduleProposals: proposal ? [proposal, ...(state.scheduleProposals || [])] : state.scheduleProposals,
    },
    applied: true,
    proposal,
    reason: proposal
      ? 'Change applied inside HOS-delegated boundary.'
      : 'Standalone schedule change applied.',
  };
}

export function acceptHOSDailyOperatingPlan(
  state: AppState,
  plan: HOSDailyOperatingPlan
): AppState {
  const authoritativeTasks = plan.executionActivities
    ? plan.executionActivities.map(task => ({
        ...task,
        allocatedStartMinutes: task.startMinutes,
        allocatedEndMinutes: task.endMinutes,
      }))
    : state.tasks;

  return {
    ...state,
    timezone: plan.timezone || state.timezone,
    activeDate: plan.localDate || state.activeDate,
    tasks: authoritativeTasks,
    dynamicAllocations: authoritativeTasks.map(task => ({
      activityId: task.id,
      instanceId: `inst-${task.id}`,
      title: task.title,
      originalStartMinutes: task.startMinutes,
      originalEndMinutes: task.endMinutes,
      allocatedStartMinutes: task.startMinutes,
      allocatedEndMinutes: task.endMinutes,
      durationMinutes: task.endMinutes - task.startMinutes,
      isCompressed: false,
      isFallback: false,
      fallbackLevel: task.fallbackLevel || 0,
      isProtected: Boolean(task.isProtected),
      priority: task.isNonNegotiable ? 5 : 3,
      reasonForAdjustment: 'Authoritative HOS Daily Operating Plan.',
      dependencyStatus: 'SATISFIED',
    })),
    scheduleAuthority: {
      mode: 'HOS',
      authoritativePlan: plan,
      lastAcceptedPlanId: plan.planId,
      lastAcceptedPlanVersion: plan.planVersion,
    },
    scheduleProposals: [],
    lastReallocationReason: `HOS Daily Operating Plan ${plan.planId}@${plan.planVersion} is authoritative.`,
  };
}


export function resolveHOSScheduleProposal(
  state: AppState,
  proposalId: string,
  decision: 'ACCEPT' | 'REJECT'
): AppState {
  const proposal = (state.scheduleProposals || []).find(p => p.id === proposalId);
  if (!proposal) return state;

  const now = new Date().toISOString();

  if (decision === 'REJECT') {
    return {
      ...state,
      scheduleProposals: (state.scheduleProposals || []).map(p =>
        p.id === proposalId ? { ...p, status: 'REJECTED', resolvedAtUtc: now } : p
      ),
    };
  }

  const allocationByTask = new Map(proposal.allocations.map(a => [a.activityId, a]));
  const tasks = state.tasks.map(task => {
    const allocation = allocationByTask.get(task.id);
    return allocation
      ? {
          ...task,
          allocatedStartMinutes: allocation.allocatedStartMinutes,
          allocatedEndMinutes: allocation.allocatedEndMinutes,
          fallbackLevel: allocation.fallbackLevel,
        }
      : task;
  });

  return {
    ...state,
    tasks,
    dynamicAllocations: [
      ...(state.dynamicAllocations || []).filter(a => !allocationByTask.has(a.activityId)),
      ...proposal.allocations,
    ],
    scheduleProposals: (state.scheduleProposals || []).map(p =>
      p.id === proposalId ? { ...p, status: 'ACCEPTED', resolvedAtUtc: now } : p
    ),
  };
}
