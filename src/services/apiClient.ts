/**
 * Execution OS API Client (EOS-004)
 * Strongly typed client for all /api/v1/hee/* REST endpoints
 */

import { AppState, RoutineTask, SystemMode, DayType, TomorrowPlan, UserOverrideRecord, AutonomyLevel } from '../types';
import { ApiError, ErrorCode, StructuredErrorResponse } from '../server/errors';

export interface ApiClientConfig {
  baseUrl?: string;
  userId?: string;
  authToken?: string;
}

export class ExecutionApiClient {
  private baseUrl: string;
  private userId: string;
  private authToken?: string;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || '';
    this.userId = config.userId || 'user-default-1';
    this.authToken = config.authToken;
  }

  private async request<T = any>(
    path: string,
    options: RequestInit & { idempotencyKey?: string; expectedVersion?: number } = {}
  ): Promise<{ data: T; state?: AppState; version?: number; success: boolean }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-Id': this.userId,
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    if (options.expectedVersion !== undefined) {
      headers['If-Match'] = options.expectedVersion.toString();
    }

    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const res = await fetch(url, {
      ...options,
      headers,
    });

    const json = await res.json();

    if (!res.ok) {
      const errPayload = json as StructuredErrorResponse;
      const code = errPayload?.error?.code || 'INTERNAL_ERROR';
      const message = errPayload?.error?.message || `API request failed with status ${res.status}`;
      const details = errPayload?.error?.details;
      throw new ApiError(code, message, res.status, details);
    }

    return json;
  }

  // =========================================================================
  // EXECUTION QUERIES
  // =========================================================================

  async getExecutionNow() {
    return this.request<{
      currentTime: string;
      currentTimeMinutes: number;
      routineState: string;
      isCompressed: boolean;
      currentMode: SystemMode;
      dayType: DayType;
      currentTask?: RoutineTask;
      activeAllocation?: any;
      nextDecision?: any;
      isTradingBlocked: boolean;
      autonomyLevel: AutonomyLevel;
      rewardPoints: number;
      version: number;
    }>('/api/v1/hee/execution/now', { method: 'GET' });
  }

  async getExecutionToday() {
    return this.request<AppState>('/api/v1/hee/execution/today', { method: 'GET' });
  }

  async getFullState() {
    return this.request<AppState>('/api/v1/hee/state', { method: 'GET' });
  }

  async resetState() {
    return this.request<AppState>('/api/v1/hee/state/reset', { method: 'POST' });
  }

  // =========================================================================
  // PLANNING & DAY ACTIVATION
  // =========================================================================

  async planTomorrow(plan: Partial<TomorrowPlan>, options: { idempotencyKey?: string; expectedVersion?: number } = {}) {
    return this.request<{ plan: TomorrowPlan }>('/api/v1/hee/plan/tomorrow', {
      method: 'POST',
      body: JSON.stringify({ plan }),
      ...options,
    });
  }

  async activateDay(payload: { mode?: SystemMode; dayType?: DayType; date?: string } = {}, options: { idempotencyKey?: string } = {}) {
    return this.request('/api/v1/hee/day/activate', {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    });
  }

  // =========================================================================
  // ACTIVITY COMMANDS
  // =========================================================================

  async startActivity(taskId: string, options: { idempotencyKey?: string; expectedVersion?: number } = {}) {
    return this.request(`/api/v1/hee/activities/${encodeURIComponent(taskId)}/start`, {
      method: 'POST',
      ...options,
    });
  }

  async pauseActivity(taskId: string, reason?: string, options: { idempotencyKey?: string } = {}) {
    return this.request(`/api/v1/hee/activities/${encodeURIComponent(taskId)}/pause`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      ...options,
    });
  }

  async resumeActivity(taskId: string, options: { idempotencyKey?: string } = {}) {
    return this.request(`/api/v1/hee/activities/${encodeURIComponent(taskId)}/resume`, {
      method: 'POST',
      ...options,
    });
  }

  async completeActivity(
    taskId: string,
    payload: {
      executionStatus?: 'ON_TIME' | 'MISSED_LATE' | 'COMPRESSED' | 'FALLBACK_EXECUTED';
      missedWindow?: boolean;
      penaltyCutPoints?: number;
      completedAtMinutes?: number;
    } = {},
    options: { idempotencyKey?: string; expectedVersion?: number } = {}
  ) {
    return this.request(`/api/v1/hee/activities/${encodeURIComponent(taskId)}/complete`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    });
  }

  async adjustActivity(
    taskId: string,
    payload: { startMinutes?: number; endMinutes?: number; reason?: string; isEmergencyOverride?: boolean },
    options: { idempotencyKey?: string } = {}
  ) {
    return this.request(`/api/v1/hee/activities/${encodeURIComponent(taskId)}/adjust`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    });
  }

  async overrideActivity(
    taskId: string,
    payload: {
      overrideType: UserOverrideRecord['overrideType'];
      reason: string;
      modifications?: Partial<RoutineTask>;
    },
    options: { idempotencyKey?: string } = {}
  ) {
    return this.request(`/api/v1/hee/activities/${encodeURIComponent(taskId)}/override`, {
      method: 'POST',
      body: JSON.stringify(payload),
      ...options,
    });
  }

  // =========================================================================
  // ALLOCATIONS & SIMULATION
  // =========================================================================

  async recalculateAllocations(force: boolean = false, reason?: string) {
    return this.request('/api/v1/hee/allocations/recalculate', {
      method: 'POST',
      body: JSON.stringify({ force, reason }),
    });
  }

  async runSimulation(payload: { simulatedTime: string; mode?: SystemMode; dayType?: DayType; dryRun?: boolean }) {
    return this.request('/api/v1/hee/simulation/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // =========================================================================
  // DECISIONS & GOVERNANCE
  // =========================================================================

  async getPendingDecisions() {
    return this.request('/api/v1/hee/decisions/pending', { method: 'GET' });
  }

  async approveDecision(decisionId: string, optionId: string) {
    return this.request(`/api/v1/hee/decisions/${encodeURIComponent(decisionId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    });
  }

  async rejectDecision(decisionId: string, reason?: string) {
    return this.request(`/api/v1/hee/decisions/${encodeURIComponent(decisionId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async getGovernancePolicies() {
    return this.request('/api/v1/hee/governance/policies', { method: 'GET' });
  }

  async updateGovernancePolicies(payload: { autonomyLevel?: AutonomyLevel; mode?: SystemMode }) {
    return this.request('/api/v1/hee/governance/policies', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async getProtectedCommitments() {
    return this.request('/api/v1/hee/governance/protected-commitments', { method: 'GET' });
  }

  async updateProtectedCommitments(commitments: any[]) {
    return this.request('/api/v1/hee/governance/protected-commitments', {
      method: 'PATCH',
      body: JSON.stringify({ commitments }),
    });
  }

  async setSystemMode(mode: SystemMode) {
    return this.request('/api/v1/hee/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  }

  async setDayType(dayType: DayType) {
    return this.request('/api/v1/hee/day-type', {
      method: 'POST',
      body: JSON.stringify({ dayType }),
    });
  }

  async setSimulatedTime(isSimulatedTime: boolean, simulatedTime: string) {
    return this.request('/api/v1/hee/time', {
      method: 'POST',
      body: JSON.stringify({ isSimulatedTime, simulatedTime }),
    });
  }

  async applyAdaptationProposal(proposalId: string) {
    return this.request(`/api/v1/hee/proposals/${encodeURIComponent(proposalId)}/apply`, {
      method: 'POST',
    });
  }

  async acceptDisciplinePenalty(taskId: string, penaltyPoints?: number) {
    return this.request(`/api/v1/hee/penalties/${encodeURIComponent(taskId)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ penaltyPoints }),
    });
  }

  // =========================================================================
  // DURABLE EVENTS & AUDIT (EOS-005)
  // =========================================================================

  async getEvents(filter?: {
    eventTypes?: string[];
    correlationId?: string;
    causationId?: string;
    streamId?: string;
    scope?: string;
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (filter?.eventTypes) params.set('eventTypes', filter.eventTypes.join(','));
    if (filter?.correlationId) params.set('correlationId', filter.correlationId);
    if (filter?.causationId) params.set('causationId', filter.causationId);
    if (filter?.streamId) params.set('streamId', filter.streamId);
    if (filter?.scope) params.set('scope', filter.scope);
    if (filter?.limit) params.set('limit', filter.limit.toString());
    if (filter?.offset) params.set('offset', filter.offset.toString());

    const qs = params.toString();
    return this.request(`/api/v1/hee/events${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  async getEventById(eventId: string) {
    return this.request(`/api/v1/hee/events/${encodeURIComponent(eventId)}`, { method: 'GET' });
  }

  async explainEvent(eventId: string) {
    return this.request(`/api/v1/hee/events/${encodeURIComponent(eventId)}/explain`, { method: 'GET' });
  }

  async getEventCausalTree(eventId: string) {
    return this.request(`/api/v1/hee/events/${encodeURIComponent(eventId)}/causal-tree`, { method: 'GET' });
  }

  async getDeadLetterQueue(filter?: { status?: string; consumerName?: string; eventType?: string }) {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.consumerName) params.set('consumerName', filter.consumerName);
    if (filter?.eventType) params.set('eventType', filter.eventType);

    const qs = params.toString();
    return this.request(`/api/v1/hee/dlq${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  async dismissDeadLetterEntry(id: string) {
    return this.request(`/api/v1/hee/dlq/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  }

  async triggerEventChain(chainType: string, body?: any) {
    return this.request(`/api/v1/hee/chains/${encodeURIComponent(chainType)}`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
  }

  // =========================================================================
  // BACKGROUND SCHEDULER & OFFLINE RECONCILIATION APIS (EOS-014)
  // =========================================================================

  async getSchedulerStatus() {
    return this.request('/api/v1/hee/scheduler/status', { method: 'GET' });
  }

  async triggerSchedulerTick(options?: { forceDayBoundary?: boolean; targetMinutes?: number }) {
    return this.request('/api/v1/hee/scheduler/tick', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async runSchedulerJob(jobType: string) {
    return this.request('/api/v1/hee/scheduler/run-job', {
      method: 'POST',
      body: JSON.stringify({ jobType }),
    });
  }

  async toggleScheduler(enabled: boolean) {
    return this.request('/api/v1/hee/scheduler/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async getNotifications() {
    return this.request('/api/v1/hee/scheduler/notifications', { method: 'GET' });
  }

  async markNotificationRead(id: string) {
    return this.request(`/api/v1/hee/scheduler/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  }

  async simulateOfflineScenario(wakeMinutes: number = 510, newDate?: string) {
    return this.request('/api/v1/hee/scheduler/simulate-offline', {
      method: 'POST',
      body: JSON.stringify({ wakeMinutes, newDate }),
    });
  }

  // =========================================================================
  // CROSS-DEVICE SYNCHRONIZATION APIS (EOS-003, EOS-004, EOS-014)
  // =========================================================================

  async syncPull(lastVersion?: number, deviceId?: string) {
    return this.request<{
      success: boolean;
      state: AppState;
      version: number;
      serverTime: string;
      devices: any[];
      conflictsResolved: any[];
    }>('/api/v1/hee/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ lastVersion, deviceId }),
    });
  }

  async syncPush(commands: any[], baseVersion: number, deviceId?: string) {
    return this.request<{
      success: boolean;
      state: AppState;
      version: number;
      resolvedConflicts: any[];
      serverTime: string;
    }>('/api/v1/hee/sync/push', {
      method: 'POST',
      body: JSON.stringify({ commands, baseVersion, deviceId }),
    });
  }

  async getDevices() {
    return this.request<{ success: boolean; devices: any[] }>('/api/v1/hee/sync/devices', { method: 'GET' });
  }

  async registerDevice(device: any) {
    return this.request('/api/v1/hee/sync/devices/register', {
      method: 'POST',
      body: JSON.stringify({ device }),
    });
  }
}

export const defaultApiClient = new ExecutionApiClient();
