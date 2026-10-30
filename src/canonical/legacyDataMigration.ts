import { AppState } from '../types';
import { CanonicalDatabase } from './canonicalDatabase';
import { EntityMapper, DEFAULT_USER_ID, DEFAULT_TIMEZONE } from './entityMapper';
import { SchemaValidator } from '../server/validation';

export interface MigrationResult {
  success: boolean;
  importedTasksCount: number;
  importedDeviationsCount: number;
  importedInterventionsCount: number;
  importedEventsCount: number;
  errors: string[];
}

export class LegacyDataMigrator {
  private mapper: EntityMapper;

  constructor(private userId: string = DEFAULT_USER_ID, private timezone: string = DEFAULT_TIMEZONE) {
    this.mapper = new EntityMapper(this.userId, this.timezone);
  }

  /**
   * Migrates legacy AppState or localStorage JSON string into the durable CanonicalDatabase
   */
  public async migrateLegacyState(
    db: CanonicalDatabase,
    legacyData: AppState | string
  ): Promise<MigrationResult> {
    const errors: string[] = [];
    let state: AppState;

    try {
      if (typeof legacyData === 'string') {
        state = JSON.parse(legacyData);
      } else {
        state = legacyData;
      }
    } catch (err: any) {
      return {
        success: false,
        importedTasksCount: 0,
        importedDeviationsCount: 0,
        importedInterventionsCount: 0,
        importedEventsCount: 0,
        errors: [`Invalid legacy JSON payload: ${err.message}`],
      };
    }

    // Validate structural integrity
    const validation = SchemaValidator.validateAppState(state);
    if (!validation.isValid) {
      errors.push(...validation.errors.map(e => `Validation warning: ${e.path}: ${e.message}`));
    }

    try {
      await db.initialize();
      const canonical = this.mapper.appStateToCanonical(state);
      await db.restoreSnapshot(canonical);

      return {
        success: true,
        importedTasksCount: (state.tasks || []).length,
        importedDeviationsCount: (state.deviations || []).length,
        importedInterventionsCount: (state.interventions || []).length,
        importedEventsCount: canonical.event_records.length,
        errors,
      };
    } catch (err: any) {
      return {
        success: false,
        importedTasksCount: 0,
        importedDeviationsCount: 0,
        importedInterventionsCount: 0,
        importedEventsCount: 0,
        errors: [...errors, `Migration execution error: ${err.message}`],
      };
    }
  }

  /**
   * Checks if legacy localStorage contains state and migrates it to durable database if present
   */
  public async migrateFromLocalStorageIfPresent(db: CanonicalDatabase, storageKey: string = 'autonomous_execution_state_v1'): Promise<MigrationResult | null> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return null;

      const result = await this.migrateLegacyState(db, raw);
      return result;
    } catch (err: any) {
      return {
        success: false,
        importedTasksCount: 0,
        importedDeviationsCount: 0,
        importedInterventionsCount: 0,
        importedEventsCount: 0,
        errors: [`Failed to read localStorage: ${err.message}`],
      };
    }
  }
}
