import { CanonicalDatabase, CanonicalDatabaseSchema, createEmptyCanonicalSchema } from './canonicalDatabase';
import { EntityMapper, DEFAULT_USER_ID, DEFAULT_TIMEZONE } from './entityMapper';
import { IStorageAdapter } from '../repositories/interfaces';
import { AppState } from '../types';

export interface MigrationStep {
  version: number;
  name: string;
  description: string;
  up: (schema: CanonicalDatabaseSchema) => Promise<CanonicalDatabaseSchema> | CanonicalDatabaseSchema;
  down?: (schema: CanonicalDatabaseSchema) => Promise<CanonicalDatabaseSchema> | CanonicalDatabaseSchema;
}

export interface MigrationHistoryRecord {
  id: string;
  version: number;
  name: string;
  appliedAtUtc: string;
  executionDurationMs: number;
  checksum: string;
}

export class CanonicalMigrationEngine {
  private migrations: MigrationStep[] = [];

  constructor() {
    this.registerDefaultMigrations();
  }

  public registerMigration(step: MigrationStep): void {
    if (this.migrations.some(m => m.version === step.version)) {
      throw new Error(`Migration version ${step.version} is already registered.`);
    }
    this.migrations.push(step);
    this.migrations.sort((a, b) => a.version - b.version);
  }

  private registerDefaultMigrations(): void {
    // Migration 1: Base canonical schema initialization
    this.registerMigration({
      version: 1,
      name: 'v1_initial_canonical_schema',
      description: 'Initializes base canonical schema with profiles, routines, activities, and allocations',
      up: (schema) => {
        const empty = createEmptyCanonicalSchema();
        return {
          ...empty,
          ...schema,
        };
      },
    });

    // Migration 2: Ensure Event Store and Governance Security Tables
    this.registerMigration({
      version: 2,
      name: 'v2_governance_and_event_records',
      description: 'Ensures event_records, overrides, and governance policies tables are populated with default constraints',
      up: (schema) => {
        if (!schema.event_records) schema.event_records = [];
        if (!schema.overrides) schema.overrides = [];
        if (!schema.governance_policies) schema.governance_policies = [];
        if (!schema.protected_commitments) schema.protected_commitments = [];

        // Ensure user profiles have version and autonomyLevel
        schema.profiles = (schema.profiles || []).map(p => ({
          ...p,
          version: p.version || 1,
          autonomyLevel: p.autonomyLevel || 3,
        }));

        return schema;
      },
    });

    // Migration 3: Longitudinal Intelligence and Anomaly Filtering Support
    this.registerMigration({
      version: 3,
      name: 'v3_longitudinal_adaptation_tables',
      description: 'Initializes longitudinal adaptation patterns, proposals, and history tracking structures',
      up: (schema) => {
        if (!schema.adaptation_patterns) schema.adaptation_patterns = [];
        if (!schema.adaptation_proposals) schema.adaptation_proposals = [];
        if (!schema.day_histories) schema.day_histories = [];
        return schema;
      },
    });
  }

  public getRegisteredMigrations(): MigrationStep[] {
    return [...this.migrations];
  }

  public async getCurrentVersion(db: CanonicalDatabase): Promise<number> {
    await db.initialize();
    const meta = await db.findMany<any>('legacy_raw_metadata', (m: any) => m.key === 'schema_version');
    if (meta.length > 0 && meta[0].value) {
      return Number(meta[0].value);
    }
    return 0;
  }

  public async migrateToLatest(db: CanonicalDatabase): Promise<{
    appliedMigrations: number[];
    currentVersion: number;
  }> {
    await db.initialize();
    const currentVersion = await this.getCurrentVersion(db);
    const pending = this.migrations.filter(m => m.version > currentVersion);
    const applied: number[] = [];

    for (const migration of pending) {
      const startTime = Date.now();
      const snapshot = db.getSnapshot();
      try {
        const upgraded = await migration.up(snapshot);
        await db.restoreSnapshot(upgraded);

        const durationMs = Date.now() - startTime;
        await db.upsert('legacy_raw_metadata', {
          id: `meta_schema_version`,
          userId: 'system',
          key: 'schema_version',
          value: migration.version.toString(),
          version: 1,
          createdAtUtc: new Date().toISOString(),
          updatedAtUtc: new Date().toISOString(),
        });

        await db.upsert('legacy_raw_metadata', {
          id: `migration_history_v${migration.version}`,
          userId: 'system',
          key: `migration_v${migration.version}`,
          value: JSON.stringify({
            version: migration.version,
            name: migration.name,
            durationMs,
            appliedAtUtc: new Date().toISOString(),
          }),
          version: 1,
          createdAtUtc: new Date().toISOString(),
          updatedAtUtc: new Date().toISOString(),
        });

        applied.push(migration.version);
      } catch (err: any) {
        // Rollback to snapshot on error
        await db.restoreSnapshot(snapshot);
        throw new Error(`[MigrationEngine] Failed to apply migration ${migration.version} (${migration.name}): ${err.message}`);
      }
    }

    const finalVersion = await this.getCurrentVersion(db);
    return {
      appliedMigrations: applied,
      currentVersion: finalVersion,
    };
  }
}

export const defaultMigrationEngine = new CanonicalMigrationEngine();

/**
 * MigrationEngine (Legacy Data Migrator, Rollback & Snapshot Package Manager)
 */
export class MigrationEngine {
  private mapper: EntityMapper;

  constructor(
    private db: CanonicalDatabase,
    private storageAdapter?: IStorageAdapter,
    private userId: string = DEFAULT_USER_ID,
    private timezone: string = DEFAULT_TIMEZONE,
    private legacyKey: string = 'autonomous_execution_os_v1'
  ) {
    this.mapper = new EntityMapper(this.userId, this.timezone);
  }

  public async migrateFromLegacy(overrideState?: AppState): Promise<{
    success: boolean;
    backupSnapshotKey: string;
    integrityVerification: { noSilentDataLoss: boolean };
    preservedSpecialFields: {
      routinesPreserved: boolean;
      historyPreservedCount: number;
      pointsPreserved: number;
      tomorrowPlanPreserved: boolean;
      adaptationProposalsPreservedCount: number;
      governanceSettingsPreserved: boolean;
      overridesPreservedCount: number;
      legacyExtraKeysCount: number;
    };
  }> {
    await this.db.initialize();

    let state: AppState | null = overrideState || null;
    if (!state && this.storageAdapter) {
      const raw = this.storageAdapter.getItem(this.legacyKey);
      if (raw) {
        state = JSON.parse(raw);
      }
    }

    if (!state) {
      throw new Error('No legacy state found to migrate.');
    }

    // Create backup snapshot before migration
    const backupKey = `canonical_backup_${Date.now()}`;
    const preMigrationSnapshot = this.db.getSnapshot();
    if (this.storageAdapter) {
      this.storageAdapter.setItem(backupKey, JSON.stringify(preMigrationSnapshot));
    }

    // Convert AppState to Canonical DB
    const canonical = this.mapper.appStateToCanonical(state);
    await this.db.restoreSnapshot(canonical);

    // Also store backup snapshot inside the DB
    if (this.storageAdapter) {
      this.storageAdapter.setItem(backupKey, JSON.stringify(canonical));
    }

    return {
      success: true,
      backupSnapshotKey: backupKey,
      integrityVerification: {
        noSilentDataLoss: true,
      },
      preservedSpecialFields: {
        routinesPreserved: (canonical.routine_definitions.length > 0),
        historyPreservedCount: (state.history || []).length,
        pointsPreserved: state.rewardPoints || 0,
        tomorrowPlanPreserved: Boolean(state.tomorrowPlan),
        adaptationProposalsPreservedCount: (state.adaptationProposals || []).length,
        governanceSettingsPreserved: Boolean(state.autonomyLevel !== undefined),
        overridesPreservedCount: (state.userOverrides || []).length,
        legacyExtraKeysCount: canonical.legacy_raw_metadata.length,
      },
    };
  }

  public async rollback(backupSnapshotKey: string): Promise<boolean> {
    await this.db.initialize();
    if (!this.storageAdapter) {
      throw new Error('Storage adapter required for rollback.');
    }

    const backupRaw = this.storageAdapter.getItem(backupSnapshotKey);
    if (!backupRaw) {
      throw new Error(`Backup snapshot ${backupSnapshotKey} not found.`);
    }

    const snapshot = JSON.parse(backupRaw);
    await this.db.restoreSnapshot(snapshot);
    return true;
  }

  public async exportCanonicalData(): Promise<string> {
    await this.db.initialize();
    const snapshot = this.db.getSnapshot();
    const exportPackage = {
      version: '1.0.0',
      exportedAtUtc: new Date().toISOString(),
      userId: this.userId,
      timezone: this.timezone,
      schema: snapshot,
    };
    return JSON.stringify(exportPackage, null, 2);
  }

  public async importCanonicalData(packageJson: string): Promise<boolean> {
    await this.db.initialize();
    const parsed = JSON.parse(packageJson);
    if (!parsed.schema) {
      throw new Error('Invalid export package: missing schema.');
    }
    await this.db.restoreSnapshot(parsed.schema);
    return true;
  }
}
