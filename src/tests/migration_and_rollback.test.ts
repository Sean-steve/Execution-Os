import { describe, it, expect, beforeEach } from 'vitest';
import { MigrationEngine } from '../canonical/migrationEngine';
import { CanonicalDatabase, InMemoryCanonicalStorageEngine } from '../canonical/canonicalDatabase';
import { InMemoryStorageAdapter } from '../repositories/implementations';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import { AppState } from '../types';

describe('Sprint 3 — Migration Engine & Rollback Verification (EOS-003, EOS-005, EOS-007)', () => {
  let db: CanonicalDatabase;
  let storageAdapter: InMemoryStorageAdapter;
  let migrationEngine: MigrationEngine;

  beforeEach(() => {
    db = new CanonicalDatabase(new InMemoryCanonicalStorageEngine());
    storageAdapter = new InMemoryStorageAdapter();
    migrationEngine = new MigrationEngine(db, storageAdapter, 'user_primary', 'UTC', 'autonomous_execution_os_v1');
  });

  it('migrates existing legacy state preserving all required aggregates', async () => {
    // Construct rich legacy state
    const legacyState: AppState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
    legacyState.rewardPoints = 450;
    legacyState.autonomyLevel = 4;
    legacyState.strictTimeEnforcement = true;
    legacyState.tomorrowPlan = {
      top3: ['Build Sprint 3 Canonical DB', 'Review Trading Gatekeeper', 'Family Dinner Outing'],
      scheduleFocus: 'Deep Architecture Execution',
      plannedMeal: 'Salmon & Broccoli',
      workoutType: 'Full Body Kettlebells',
      companyPriority: 'EOS Production Release',
      familyActivity: 'Board Games',
      tradingConditions: 'Risk Aversion: High volatility',
    };
    legacyState.adaptationProposals = [
      {
        id: 'prop-custom-1',
        patternId: 'pat-1',
        activityId: 'task-meditation',
        title: 'Move meditation earlier',
        description: 'Reduce overlap by 15m',
        suggestedChange: { property: 'startMinutes', fromValue: 380, toValue: 365 },
        impactLevel: 'LOW_RISK_AUTO',
        status: 'PROPOSED',
        proposedAt: '2026-08-17T08:00:00Z',
      }
    ];
    legacyState.userOverrides = [
      {
        id: 'ovr-1',
        timestamp: '2026-08-17T09:00:00Z',
        activityId: 'task-deep-work-build',
        overrideType: 'ADVANCE',
        reason: 'Client called early',
        previousState: { startMinutes: 480 },
        newState: { startMinutes: 450 },
      }
    ];
    legacyState.history = [
      {
        date: '2026-08-15',
        score: 7,
        mode: 'GREEN',
        dayType: 'STANDARD',
        pillars: { morning: true, body: true, mission: true, business: true, wealthTrading: true, family: true, eveningShutdown: true },
        topVictory: 'Shipped sprint ahead of schedule',
      }
    ];
    // Attach unknown custom legacy key to test safe preservation
    (legacyState as any).customLegacyIntegrationApiKey = 'legacy_secret_val_123';

    // Store in legacy storage
    storageAdapter.setItem('autonomous_execution_os_v1', JSON.stringify(legacyState));

    // Run migration
    const report = await migrationEngine.migrateFromLegacy();

    expect(report.success).toBe(true);
    expect(report.integrityVerification.noSilentDataLoss).toBe(true);
    expect(report.preservedSpecialFields.routinesPreserved).toBe(true);
    expect(report.preservedSpecialFields.historyPreservedCount).toBe(1);
    expect(report.preservedSpecialFields.pointsPreserved).toBe(450);
    expect(report.preservedSpecialFields.tomorrowPlanPreserved).toBe(true);
    expect(report.preservedSpecialFields.adaptationProposalsPreservedCount).toBe(legacyState.adaptationProposals.length);
    expect(report.preservedSpecialFields.governanceSettingsPreserved).toBe(true);
    expect(report.preservedSpecialFields.overridesPreservedCount).toBe(1);
    expect(report.preservedSpecialFields.legacyExtraKeysCount).toBeGreaterThan(0);

    // Verify unknown legacy state preserved in legacy_raw_metadata
    const legacyMetadata = await db.findMany<any>('legacy_raw_metadata', m => m.key === 'customLegacyIntegrationApiKey');
    expect(legacyMetadata.length).toBe(1);
    expect(legacyMetadata[0].rawPayload).toBe('legacy_secret_val_123');
  });

  it('provides rollback path from backup snapshot without data loss', async () => {
    const legacyState: AppState = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
    legacyState.rewardPoints = 888;
    storageAdapter.setItem('autonomous_execution_os_v1', JSON.stringify(legacyState));

    const report = await migrationEngine.migrateFromLegacy();
    expect(report.backupSnapshotKey).toBeDefined();

    // Verify migrated database has points
    const profileBefore = await db.findById<any>('profiles', 'profile_user_primary');
    expect(profileBefore.rewardPoints).toBe(888);

    // Perform rollback
    const rollbackSuccess = await migrationEngine.rollback(report.backupSnapshotKey);
    expect(rollbackSuccess).toBe(true);

    // Verify restored state
    const profileAfter = await db.findById<any>('profiles', 'profile_user_primary');
    expect(profileAfter.rewardPoints).toBe(888);
  });

  it('supports export and import of canonical database packages', async () => {
    const canonical = await migrationEngine.migrateFromLegacy(DEFAULT_APP_STATE);
    expect(canonical.success).toBe(true);

    const exportedJson = await migrationEngine.exportCanonicalData();
    expect(typeof exportedJson).toBe('string');
    expect(exportedJson).toContain('"version": "1.0.0"');

    // Clear db and re-import
    await db.clearAll();
    expect(await db.count('profiles')).toBe(0);

    const importSuccess = await migrationEngine.importCanonicalData(exportedJson);
    expect(importSuccess).toBe(true);
    expect(await db.count('profiles')).toBeGreaterThan(0);
  });
});
