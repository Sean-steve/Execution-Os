import {
  AppState,
  DynamicAllocation,
  RoutineTask,
  ScheduleBoundaryWindow,
  ScheduleChangeProposal,
} from '../types';

export function getProtectedScheduleWindows(state: AppState): ScheduleBoundaryWindow[] {
  const authorityWindows = state.scheduleAuthority?.protectedWindows || [];
  const planWindows: ScheduleBoundaryWindow[] = (state.tomorrowPlan?.protectedCommitments || []).map(c => ({
    id: c.id,
    startMinutes: c.startMinutes,
    endMinutes: c.endMinutes,
    type: 'PROTECTED',
    label: c.title,
    source: state.scheduleAuthority?.mode === 'HOS_DELEGATED' ? 'HOS' : 'USER',
  }));
  const protectedAppointments: ScheduleBoundaryWindow[] = (state.tomorrowPlan?.appointments || [])
    .filter(a => a.isProtected)
    .map(a => ({
      id: a.id,
      startMinutes: a.startMinutes,
      endMinutes: a.endMinutes,
      type: 'FIXED',
      label: a.title,
      source: state.scheduleAuthority?.mode === 'HOS_DELEGATED' ? 'HOS' : 'USER',
    }));
  const protectedTasks: ScheduleBoundaryWindow[] = state.tasks
    .filter(t => t.isProtected)
    .map(t => ({
      id: `task-window-${t.id}`,
      startMinutes: t.startMinutes,
      endMinutes: t.endMinutes,
      type: 'PROTECTED',
      label: t.title,
      source: 'USER',
    }));

  const byId = new Map<string, ScheduleBoundaryWindow>();
  [...authorityWindows, ...planWindows, ...protectedAppointments, ...protectedTasks]
    .forEach(w => byId.set(w.id, w));
  return [...byId.values()];
}

export function overlapsProtectedSchedule(
  state: AppState,
  startMinutes: number,
  endMinutes: number,
  activityId?: string
): ScheduleBoundaryWindow | undefined {
  return getProtectedScheduleWindows(state).find(window => {
    if (activityId && (window.id === activityId || window.id === `task-window-${activityId}`)) return false;
    return startMinutes < window.endMinutes && endMinutes > window.startMinutes;
  });
}

function isWithinApprovedWindow(state: AppState, startMinutes: number, endMinutes: number): boolean {
  const windows = state.scheduleAuthority?.approvedWindows || [];
  if (!windows.length) return false;
  return windows.some(window =>
    window.type === 'EXECUTION_ALLOWED' &&
    startMinutes >= window.startMinutes &&
    endMinutes <= window.endMinutes
  );
}

export interface ScheduleAuthorityReconciliation {
  allocations: DynamicAllocation[];
  tasks: RoutineTask[];
  proposal?: ScheduleChangeProposal;
  autonomousChangesApplied: number;
  proposedChangesCount: number;
}

/**
 * Reconciles an Execution OS allocation proposal with the host schedule authority.
 * In HOS_DELEGATED mode the HOS Daily Operating Plan remains final authority.
 */
export function reconcileWithScheduleAuthority(
  state: AppState,
  proposedAllocations: DynamicAllocation[],
  proposedTasks: RoutineTask[],
  reason: string,
  nowUtc: string = new Date().toISOString()
): ScheduleAuthorityReconciliation {
  const authority = state.scheduleAuthority;
  if (!authority || authority.mode === 'STANDALONE') {
    return {
      allocations: proposedAllocations,
      tasks: proposedTasks,
      autonomousChangesApplied: proposedAllocations.filter(a =>
        a.allocatedStartMinutes !== a.originalStartMinutes ||
        a.allocatedEndMinutes !== a.originalEndMinutes
      ).length,
      proposedChangesCount: 0,
    };
  }

  const changes: ScheduleChangeProposal['changes'] = [];
  const allowedActivityIds = new Set<string>();

  for (const allocation of proposedAllocations) {
    const changed =
      allocation.allocatedStartMinutes !== allocation.originalStartMinutes ||
      allocation.allocatedEndMinutes !== allocation.originalEndMinutes;
    if (!changed) {
      allowedActivityIds.add(allocation.activityId);
      continue;
    }

    const shift = Math.max(
      Math.abs(allocation.allocatedStartMinutes - allocation.originalStartMinutes),
      Math.abs(allocation.allocatedEndMinutes - allocation.originalEndMinutes)
    );
    const overlapsProtected = overlapsProtectedSchedule(
      state,
      allocation.allocatedStartMinutes,
      allocation.allocatedEndMinutes,
      allocation.activityId
    );
    const withinBoundary =
      shift <= authority.maxAutonomousShiftMinutes &&
      isWithinApprovedWindow(state, allocation.allocatedStartMinutes, allocation.allocatedEndMinutes) &&
      (!allocation.isCompressed || authority.allowAutonomousCompression) &&
      !overlapsProtected;

    if (withinBoundary) {
      allowedActivityIds.add(allocation.activityId);
    } else {
      changes.push({
        activityId: allocation.activityId,
        fromStartMinutes: allocation.originalStartMinutes,
        fromEndMinutes: allocation.originalEndMinutes,
        proposedStartMinutes: allocation.allocatedStartMinutes,
        proposedEndMinutes: allocation.allocatedEndMinutes,
        compressed: allocation.isCompressed,
        fallbackLevel: allocation.fallbackLevel,
      });
    }
  }

  const blockedIds = new Set(changes.map(change => change.activityId));
  const reconciledAllocations = proposedAllocations.map(allocation => {
    if (!blockedIds.has(allocation.activityId)) return allocation;
    return {
      ...allocation,
      allocatedStartMinutes: allocation.originalStartMinutes,
      allocatedEndMinutes: allocation.originalEndMinutes,
      durationMinutes: allocation.originalEndMinutes - allocation.originalStartMinutes,
      isCompressed: false,
      isFallback: false,
      fallbackLevel: 0,
      reasonForAdjustment: 'HOS Daily Operating Plan retained; Execution OS change proposed for host approval.',
    };
  });

  const originalTaskById = new Map(state.tasks.map(task => [task.id, task]));
  const reconciledTasks = proposedTasks.map(task => {
    if (!blockedIds.has(task.id)) return task;
    const original = originalTaskById.get(task.id);
    return original ? { ...original } : task;
  });

  const proposal: ScheduleChangeProposal | undefined = changes.length
    ? {
        id: `sched-proposal-${Date.now()}`,
        source: 'EXECUTION_OS',
        authority: 'HOS',
        planId: authority.planId,
        planRevision: authority.planRevision,
        createdAtUtc: nowUtc,
        reason,
        status: 'PROPOSED',
        changes,
      }
    : undefined;

  return {
    allocations: reconciledAllocations,
    tasks: reconciledTasks,
    proposal,
    autonomousChangesApplied: allowedActivityIds.size,
    proposedChangesCount: changes.length,
  };
}


export function bindHosDailyOperatingPlan(
  state: AppState,
  authority: NonNullable<AppState['scheduleAuthority']>
): AppState {
  if (authority.mode !== 'HOS_DELEGATED') {
    throw new Error('HOS Daily Operating Plan binding requires HOS_DELEGATED authority mode.');
  }

  return {
    ...state,
    scheduleAuthority: {
      ...authority,
      approvedWindows: [...authority.approvedWindows],
      protectedWindows: [...authority.protectedWindows],
      receivedAtUtc: authority.receivedAtUtc || new Date().toISOString(),
    },
    pendingScheduleProposals: (state.pendingScheduleProposals || []).map(proposal =>
      proposal.status === 'PROPOSED'
        ? { ...proposal, status: 'SUPERSEDED' as const }
        : proposal
    ),
    lastReallocationReason: `HOS Daily Operating Plan ${authority.planId || 'unidentified'} revision ${authority.planRevision ?? 0} accepted as schedule authority.`,
  };
}

export function resolveScheduleProposal(
  state: AppState,
  proposalId: string,
  decision: 'ACCEPTED' | 'REJECTED'
): AppState {
  const proposal = (state.pendingScheduleProposals || []).find(p => p.id === proposalId);
  if (!proposal || proposal.status !== 'PROPOSED') return state;

  let tasks = state.tasks;
  let allocations = state.dynamicAllocations;

  if (decision === 'ACCEPTED') {
    const changes = new Map(proposal.changes.map(change => [change.activityId, change]));
    tasks = tasks.map(task => {
      const change = changes.get(task.id);
      if (!change) return task;
      return {
        ...task,
        allocatedStartMinutes: change.proposedStartMinutes,
        allocatedEndMinutes: change.proposedEndMinutes,
        fallbackLevel: change.fallbackLevel ?? task.fallbackLevel,
      };
    });
    allocations = allocations.map(allocation => {
      const change = changes.get(allocation.activityId);
      if (!change) return allocation;
      return {
        ...allocation,
        allocatedStartMinutes: change.proposedStartMinutes,
        allocatedEndMinutes: change.proposedEndMinutes,
        durationMinutes: change.proposedEndMinutes - change.proposedStartMinutes,
        isCompressed: change.compressed,
        fallbackLevel: change.fallbackLevel ?? allocation.fallbackLevel,
        reasonForAdjustment: 'Accepted by HOS schedule authority.',
      };
    });
  }

  return {
    ...state,
    tasks,
    dynamicAllocations: allocations,
    pendingScheduleProposals: (state.pendingScheduleProposals || []).map(p =>
      p.id === proposalId ? { ...p, status: decision } : p
    ),
  };
}
