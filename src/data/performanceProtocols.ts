import {
  PerformanceProtocol,
  ExecutionEnvironmentType,
  CompletionPolicyType,
  EvidenceLevel
} from '../types';

export const CANONICAL_PERFORMANCE_PROTOCOLS: PerformanceProtocol[] = [
  // 1. DEEP WORK (ASSISTED)
  {
    id: 'protocol-deep-work-v1',
    version: '1.0.0',
    name: 'Deep Work Focus Protocol',
    description: 'Assisted focus environment with objective clarification, distraction elimination, and tangible artifact output.',
    applicableActivityType: 'DEEP_WORK',
    applicableEnvironment: 'ASSISTED',
    preparationRituals: [
      'Clarify exact primary objective & definition of victory',
      'Put phone away and activate do-not-disturb',
      'Close unrelated browser tabs and messaging apps',
      'Open required tooling, code repository, or document workspace',
      'Commit to uninterrupted active focus'
    ],
    steps: [
      {
        id: 'step-dw-prep',
        type: 'PREPARE',
        title: 'Focus Preparation & Shield',
        description: 'Review objective and eliminate external distractions before timer initiation.',
        requiresConfirmation: true
      },
      {
        id: 'step-dw-focus',
        type: 'TIMER',
        title: 'Core Deep Work Session',
        description: 'Engage in high-leverage cognitive execution without context switching.',
        targetDurationSeconds: 90 * 60,
        minimumDurationSeconds: 45 * 60
      },
      {
        id: 'step-dw-artifact',
        type: 'EVIDENCE',
        title: 'Output & Artifact Capture',
        description: 'Record tangible work artifact (git commit, document draft, architectural decision, or concrete milestone).',
        isOptional: false
      },
      {
        id: 'step-dw-close',
        type: 'CLOSE',
        title: 'Session Debrief & Closure',
        description: 'Evaluate objective outcome, record remaining blockers, and release schedule capacity.',
        requiresConfirmation: true
      }
    ],
    evidencePolicy: {
      requiredLevel: 'E1',
      allowedEvidenceTypes: ['TIMER_PASS', 'NOTE_BODY', 'COMMIT_HASH', 'CHECKLIST_CONFIRM']
    },
    completionPolicy: 'COMPOSITE',
    targetDurationMinutes: 90,
    minimumDurationMinutes: 45
  },

  // 2. MORNING PRIME (GUIDED)
  {
    id: 'protocol-morning-prime-v1',
    version: '1.0.0',
    name: 'Morning Prime Guided Protocol',
    description: 'Sequenced morning grounding covering identity recall, somatic activation, and command review.',
    applicableActivityType: 'MORNING_LIGHT',
    applicableEnvironment: 'GUIDED',
    preparationRituals: [
      'Hydrate with mineral water',
      'Transition away from sleep environment',
      'Prepare calm space for morning activation'
    ],
    steps: [
      {
        id: 'step-mp-identity',
        type: 'INSTRUCTION',
        title: 'Identity Recall & Mission Alignment',
        description: 'Affirm core life vectors, personal values, and current horizon commitments.',
        requiresConfirmation: true
      },
      {
        id: 'step-mp-journal',
        type: 'INSTRUCTION',
        title: 'Dream & Clarity Journaling',
        description: 'Capture subconscious reflections and mental noise onto the record.',
        requiresConfirmation: true
      },
      {
        id: 'step-mp-light',
        type: 'TIMER',
        title: 'Outdoor Sunlight Exposure',
        description: 'View natural morning daylight to anchor circadian clock.',
        targetDurationSeconds: 15 * 60,
        minimumDurationSeconds: 10 * 60
      },
      {
        id: 'step-mp-workout',
        type: 'CHECKPOINT',
        title: 'Whole-Body Activation',
        description: 'Complete morning physical movement sets to activate neuro-muscular readiness.',
        requiredQuantity: 3
      },
      {
        id: 'step-mp-meditation',
        type: 'TIMER',
        title: 'Mindfulness & Neural Calldown',
        description: 'Silent or guided breath focus and nervous system regulation.',
        targetDurationSeconds: 20 * 60,
        minimumDurationSeconds: 10 * 60
      },
      {
        id: 'step-mp-command-review',
        type: 'CLOSE',
        title: 'Command Center & Horizon Review',
        description: 'Inspect today timeline, verify priority anchors, and enter execution state.',
        requiresConfirmation: true
      }
    ],
    evidencePolicy: {
      requiredLevel: 'E1',
      allowedEvidenceTypes: ['TIMER_PASS', 'CHECKLIST_CONFIRM', 'SET_COUNTER']
    },
    completionPolicy: 'PROTOCOL',
    targetDurationMinutes: 60,
    minimumDurationMinutes: 30
  },

  // 3. MEDITATION (GUIDED / PHYSICAL)
  {
    id: 'protocol-meditation-v1',
    version: '1.0.0',
    name: 'Mindfulness Meditation Protocol',
    description: 'Guided or unguided breath and somatic awareness session with authoritative active duration tracking.',
    applicableActivityType: 'MEDITATION',
    applicableEnvironment: 'GUIDED',
    preparationRituals: [
      'Sit comfortably with upright spine',
      'Close eyes or lower gaze',
      'Take three diaphragmatic cleansing breaths'
    ],
    steps: [
      {
        id: 'step-med-timer',
        type: 'TIMER',
        title: 'Mindfulness Meditation',
        description: 'Sustain present-moment attention on breath and somatic sensations.',
        targetDurationSeconds: 30 * 60,
        minimumDurationSeconds: 15 * 60
      },
      {
        id: 'step-med-close',
        type: 'CLOSE',
        title: 'Session Grounding',
        description: 'Record subjective clarity and transition smoothly back to daily activity.',
        requiresConfirmation: true
      }
    ],
    evidencePolicy: {
      requiredLevel: 'E1',
      allowedEvidenceTypes: ['TIMER_PASS', 'CHECKLIST_CONFIRM']
    },
    completionPolicy: 'MINIMUM_DURATION',
    targetDurationMinutes: 30,
    minimumDurationMinutes: 15
  },

  // 4. WORKOUT / PHYSICAL MOVEMENT (GUIDED / PHYSICAL)
  {
    id: 'protocol-workout-v1',
    version: '1.0.0',
    name: 'Structured Physical Training Protocol',
    description: 'Resistance or functional movement protocol with set progression and rest timers.',
    applicableActivityType: 'WORKOUT',
    applicableEnvironment: 'GUIDED',
    preparationRituals: [
      'Ensure hydration and training attire ready',
      'Verify equipment and training space clear',
      'Warm up joints and elevate core temperature'
    ],
    steps: [
      {
        id: 'step-wk-set1',
        type: 'CHECKPOINT',
        title: 'Working Set 1',
        description: 'Execute primary resistance compound movements with strict form.',
        requiredQuantity: 1
      },
      {
        id: 'step-wk-rest1',
        type: 'BREAK',
        title: 'Inter-Set Recovery',
        description: 'Rest and heart rate regulation (90–120s).',
        targetDurationSeconds: 90
      },
      {
        id: 'step-wk-set2',
        type: 'CHECKPOINT',
        title: 'Working Set 2',
        description: 'Execute secondary training volume with progressive overload.',
        requiredQuantity: 1
      },
      {
        id: 'step-wk-rest2',
        type: 'BREAK',
        title: 'Inter-Set Recovery',
        description: 'Rest and hydration.',
        targetDurationSeconds: 90
      },
      {
        id: 'step-wk-set3',
        type: 'CHECKPOINT',
        title: 'Working Set 3 / Finisher',
        description: 'Execute final working set or mobility finisher.',
        requiredQuantity: 1
      },
      {
        id: 'step-wk-close',
        type: 'CLOSE',
        title: 'Training Log & Cooldown',
        description: 'Record completed volume, rating of perceived exertion, and initiate recovery.',
        requiresConfirmation: true
      }
    ],
    evidencePolicy: {
      requiredLevel: 'E1',
      allowedEvidenceTypes: ['SET_COUNTER', 'CHECKLIST_CONFIRM', 'TIMER_PASS']
    },
    completionPolicy: 'QUANTITY',
    targetDurationMinutes: 45,
    minimumDurationMinutes: 20
  },

  // 5. EXTERNAL-GATED EXECUTION PROTOCOL
  {
    id: 'protocol-external-gated-v1',
    version: '1.0.0',
    name: 'External-Gated Execution Protocol',
    description: 'Generic protocol for activities whose eligibility is governed by another domain engine.',
    applicableActivityType: 'EXTERNAL_GATED',
    applicableEnvironment: 'GUIDED',
    preparationRituals: [
      'Load the external-domain execution context',
      'Verify the external gate is open or satisfied',
      'Confirm the current execution objective'
    ],
    steps: [
      {
        id: 'gate-ext-context',
        type: 'CHECKPOINT',
        title: 'External Context Ready',
        description: 'Required context from the owning domain is available.',
        requiresConfirmation: true
      },
      {
        id: 'gate-ext-eligibility',
        type: 'EVIDENCE',
        title: 'External Eligibility',
        description: 'Capture the generic gate/evidence record supplied by the owning domain.',
        requiresConfirmation: true
      },
      {
        id: 'gate-ext-execute',
        type: 'INSTRUCTION',
        title: 'Execute Within Authorized Boundary',
        description: 'Perform only the action authorized by the external domain gate.',
        requiresConfirmation: true
      },
      {
        id: 'gate-ext-close',
        type: 'CLOSE',
        title: 'Close & Return Evidence',
        description: 'Record the execution outcome without redefining external-domain policy.',
        requiresConfirmation: true
      }
    ],
    evidencePolicy: {
      requiredLevel: 'E2',
      allowedEvidenceTypes: ['EXTERNAL_GATE_RECORD', 'CHECKLIST_CONFIRM', 'INTEGRATION_EVIDENCE']
    },
    completionPolicy: 'PROTOCOL',
    targetDurationMinutes: 45,
    minimumDurationMinutes: 5
  },

  // 6. PROTECTED PRESENCE / LOW-SCREEN PROTOCOL
  {
    id: 'protocol-presence-v1',
    version: '1.0.0',
    name: 'Protected Presence Protocol',
    description: 'Generic low-screen environment for any HOS-protected human-life commitment.',
    applicableActivityType: 'PRESENCE',
    applicableEnvironment: 'EXTERNAL',
    preparationRituals: [
      'Conclude the active execution session',
      'Suppress low-priority execution noise',
      'Enter the protected commitment fully'
    ],
    steps: [
      {
        id: 'step-presence-enter',
        type: 'PREPARE',
        title: 'Enter Protected Presence',
        description: 'Execution OS acknowledges the protected commitment and yields attention.',
        requiresConfirmation: true
      },
      {
        id: 'step-presence-live',
        type: 'INSTRUCTION',
        title: 'Screen-Away Presence',
        description: 'Execution OS stays quiet while the human is present in the protected commitment.',
        requiresConfirmation: false
      },
      {
        id: 'step-presence-return',
        type: 'CLOSE',
        title: 'Return to Execution',
        description: 'Acknowledge return and resume from the authoritative operating plan.',
        requiresConfirmation: true
      }
    ],
    evidencePolicy: {
      requiredLevel: 'E0',
      allowedEvidenceTypes: ['SCREEN_AWAY_RETURN', 'CHECKLIST_CONFIRM']
    },
    completionPolicy: 'BINARY_CONFIRMATION',
    targetDurationMinutes: 60,
    minimumDurationMinutes: 0
  }
];

export function getProtocolById(protocolId: string): PerformanceProtocol | undefined {
  return CANONICAL_PERFORMANCE_PROTOCOLS.find(p => p.id === protocolId);
}

export function getProtocolForActivity(activityType: string, environment?: ExecutionEnvironmentType): PerformanceProtocol {
  // Activity semantics are authoritative. Shared environments such as GUIDED
  // are only a fallback when no exact activity protocol exists.
  const activityMatch = CANONICAL_PERFORMANCE_PROTOCOLS.find(
    p => p.applicableActivityType === activityType
  );
  if (activityMatch) return activityMatch;

  const environmentMatch = environment
    ? CANONICAL_PERFORMANCE_PROTOCOLS.find(p => p.applicableEnvironment === environment)
    : undefined;
  if (environmentMatch) return environmentMatch;

  // Generic fallback protocol
  return {
    id: `protocol-generic-${activityType.toLowerCase()}`,
    version: '1.0.0',
    name: `${activityType} Performance Protocol`,
    description: 'Standard performance protocol with preparation and closure.',
    applicableActivityType: activityType,
    applicableEnvironment: environment || 'IN_APP',
    preparationRituals: ['Review objective', 'Prepare workspace', 'Begin focused effort'],
    steps: [
      {
        id: 'step-gen-prep',
        type: 'PREPARE',
        title: 'Session Preparation',
        description: 'Ensure focus conditions are satisfied.',
        requiresConfirmation: true
      },
      {
        id: 'step-gen-active',
        type: 'TIMER',
        title: 'Active Execution',
        description: 'Engage in task execution.',
        targetDurationSeconds: 30 * 60,
        minimumDurationSeconds: 10 * 60
      },
      {
        id: 'step-gen-close',
        type: 'CLOSE',
        title: 'Session Closure',
        description: 'Record completion status.',
        requiresConfirmation: true
      }
    ],
    evidencePolicy: {
      requiredLevel: 'E0',
      allowedEvidenceTypes: ['CHECKLIST_CONFIRM', 'TIMER_PASS']
    },
    completionPolicy: 'BINARY_CONFIRMATION',
    targetDurationMinutes: 30,
    minimumDurationMinutes: 10
  };
}
