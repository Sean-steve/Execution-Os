import { DEFAULT_APP_STATE } from '../data/defaultData';
import { LEGACY_STANDALONE_FIXTURE_STATE } from './fixtures/legacyStandaloneProfile';

const fixture = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
for (const key of Object.keys(DEFAULT_APP_STATE as any)) {
  delete (DEFAULT_APP_STATE as any)[key];
}
Object.assign(DEFAULT_APP_STATE as any, fixture);

(DEFAULT_APP_STATE as any).legacyStandaloneCompatibility = true;

(DEFAULT_APP_STATE as any).tasks = (DEFAULT_APP_STATE as any).tasks.map((task: any) => {
  const legacyProtected =
    task.isProtected ||
    task.interactiveActionType === 'FAMILY_OUTING' ||
    task.anchorId === 'ANCHOR_8_HUMAN_LIFE' ||
    task.anchorId === 'ANCHOR_9_CONNECT';
  return legacyProtected ? { ...task, isProtected: true } : task;
});
// Test-only: legacy family/presence semantics are represented as explicit protected commitments.

(DEFAULT_APP_STATE as any).externalExecutionGates = [{
  id: 'legacy-trading-execution-gate',
  sourceEngine: 'LEGACY_TRADING_COMPATIBILITY_ADAPTER',
  targetActivityId: 'task-trading-execution',
  capability: 'external.execution.authorize',
  status: 'BLOCKED',
  reason: 'Market Analysis must be finalized and logged before external execution is permitted.',
  evaluatedAtUtc: new Date().toISOString(),
  version: 1,
}];
