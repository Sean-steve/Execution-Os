export interface HOSEngineCapabilityDefinition {
  name:
    | 'schedule.get'
    | 'session.start'
    | 'session.advance'
    | 'session.close'
    | 'fallback.trigger'
    | 'discipline.score.get';
  kind: 'QUERY' | 'COMMAND';
  permission: string;
  consentScope: string;
  description: string;
  idempotencyRequired: boolean;
}

export interface HOSEngineManifest {
  engineId: 'execution-os';
  displayName: 'Execution OS';
  contractVersion: string;
  engineVersion: string;
  identityAuthority: 'HumanKernelOS';
  scheduleAuthority: 'HumanKernelOS';
  capabilities: HOSEngineCapabilityDefinition[];
  consumesSignals: string[];
  publishesEvents: string[];
  lifecycle: {
    healthPath: string;
    lifecyclePath: string;
    states: string[];
  };
}

export const HOS_ENGINE_CAPABILITIES: HOSEngineCapabilityDefinition[] = [
  {
    name: 'schedule.get',
    kind: 'QUERY',
    permission: 'execution.schedule.read',
    consentScope: 'execution.schedule',
    description: 'Read the HOS-authoritative execution schedule, allocations and pending schedule proposals.',
    idempotencyRequired: false,
  },
  {
    name: 'session.start',
    kind: 'COMMAND',
    permission: 'execution.session.write',
    consentScope: 'execution.performance',
    description: 'Create or start a governed HEE-011 performance session for a delegated activity.',
    idempotencyRequired: true,
  },
  {
    name: 'session.advance',
    kind: 'COMMAND',
    permission: 'execution.session.write',
    consentScope: 'execution.performance',
    description: 'Advance a governed performance protocol step.',
    idempotencyRequired: true,
  },
  {
    name: 'session.close',
    kind: 'COMMAND',
    permission: 'execution.session.write',
    consentScope: 'execution.performance',
    description: 'Close a governed performance session with an explicit terminal outcome.',
    idempotencyRequired: true,
  },
  {
    name: 'fallback.trigger',
    kind: 'COMMAND',
    permission: 'execution.fallback.write',
    consentScope: 'execution.adaptation',
    description: 'Trigger an authorized fallback tier for a delegated execution activity.',
    idempotencyRequired: true,
  },
  {
    name: 'discipline.score.get',
    kind: 'QUERY',
    permission: 'execution.discipline.read',
    consentScope: 'execution.analytics',
    description: 'Read the current execution-discipline score derived from real execution evidence.',
    idempotencyRequired: false,
  },
];

export const HOS_ENGINE_MANIFEST: HOSEngineManifest = {
  engineId: 'execution-os',
  displayName: 'Execution OS',
  contractVersion: '1.1.0',
  engineVersion: 'E9',
  identityAuthority: 'HumanKernelOS',
  scheduleAuthority: 'HumanKernelOS',
  capabilities: HOS_ENGINE_CAPABILITIES,
  consumesSignals: [
    'hos.daily_operating_plan.updated',
    'hos.schedule_proposal.resolved',
    'hos.external_execution_gate.updated',
    'hos.human_state.updated',
    'hos.pdie.recommendation.created',
  ],
  publishesEvents: [
    'execution.activity.started',
    'execution.activity.completed',
    'execution.session.started',
    'execution.session.advanced',
    'execution.session.closed',
    'execution.fallback.triggered',
    'execution.schedule.proposal.created',
    'execution.schedule.proposal.accepted',
    'execution.schedule.proposal.rejected',
    'execution.decision.requested',
    'execution.behavior.signal',
  ],
  lifecycle: {
    healthPath: '/api/v1/hos/health',
    lifecyclePath: '/api/v1/hos/lifecycle',
    states: ['REGISTERED', 'ACTIVE', 'PAUSED', 'DEGRADED'],
  },
};
