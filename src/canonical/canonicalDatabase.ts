import {
  UserExecutionProfile,
  RoutineDefinition,
  RoutineVersion,
  RoutineStep,
  ActivityDefinitionEntity,
  ActivityInstanceEntity,
  AllocationEntity,
  AllocationConflictEntity,
  DependencyEntity,
  FallbackPolicyEntity,
  FallbackOptionEntity,
  ExecutionSessionEntity,
  ExecutionEvidenceEntity,
  DeviationEntity,
  InterventionEntity,
  DecisionContextEntity,
  DecisionCandidateEntity,
  DecisionEntity,
  AdaptationPatternEntity,
  AdaptationProposalEntity,
  ExperimentEntity,
  GovernancePolicyEntity,
  ProtectedCommitmentEntity,
  OverrideEntity,
  EventRecordEntity,
  RewardLedgerEntity,
  RewardDefinitionEntity,
  DayHistoryEntity,
  LegacyRawMetadataEntity,
  VersionedEntity,
  UserScopedEntity
} from './entities';

export class OptimisticLockError extends Error {
  constructor(
    public readonly entityName: string,
    public readonly entityId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `OptimisticLockError on ${entityName}:${entityId} - Expected version ${expectedVersion}, but found version ${actualVersion}`
    );
    this.name = 'OptimisticLockError';
  }
}

export class EntityNotFoundError extends Error {
  constructor(public readonly entityName: string, public readonly entityId: string) {
    super(`Entity not found in ${entityName} with id ${entityId}`);
    this.name = 'EntityNotFoundError';
  }
}

export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(`Data Invariant Violation: ${message}`);
    this.name = 'InvariantViolationError';
  }
}

export interface CanonicalDatabaseSchema {
  profiles: UserExecutionProfile[];
  routine_definitions: RoutineDefinition[];
  routine_versions: RoutineVersion[];
  routine_steps: RoutineStep[];
  activity_definitions: ActivityDefinitionEntity[];
  activity_instances: ActivityInstanceEntity[];
  allocations: AllocationEntity[];
  allocation_conflicts: AllocationConflictEntity[];
  dependencies: DependencyEntity[];
  fallback_policies: FallbackPolicyEntity[];
  fallback_options: FallbackOptionEntity[];
  execution_sessions: ExecutionSessionEntity[];
  execution_evidences: ExecutionEvidenceEntity[];
  deviations: DeviationEntity[];
  interventions: InterventionEntity[];
  decision_contexts: DecisionContextEntity[];
  decision_candidates: DecisionCandidateEntity[];
  decisions: DecisionEntity[];
  adaptation_patterns: AdaptationPatternEntity[];
  adaptation_proposals: AdaptationProposalEntity[];
  experiments: ExperimentEntity[];
  governance_policies: GovernancePolicyEntity[];
  protected_commitments: ProtectedCommitmentEntity[];
  overrides: OverrideEntity[];
  event_records: EventRecordEntity[];
  reward_ledgers: RewardLedgerEntity[];
  reward_definitions: RewardDefinitionEntity[];
  day_histories: DayHistoryEntity[];
  legacy_raw_metadata: LegacyRawMetadataEntity[];
}

export type TableName = keyof CanonicalDatabaseSchema;

export interface ICanonicalDatabaseStorageEngine {
  loadData(): Promise<CanonicalDatabaseSchema | null>;
  saveData(data: CanonicalDatabaseSchema): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-Memory Database Storage Engine (for testing & headless execution)
 */
export class InMemoryCanonicalStorageEngine implements ICanonicalDatabaseStorageEngine {
  private data: CanonicalDatabaseSchema | null = null;

  async loadData(): Promise<CanonicalDatabaseSchema | null> {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  async saveData(data: CanonicalDatabaseSchema): Promise<void> {
    this.data = JSON.parse(JSON.stringify(data));
  }

  async clear(): Promise<void> {
    this.data = null;
  }
}

/**
 * LocalStorage / Persistent JSON database engine (with fallback)
 */
export class LocalStorageCanonicalEngine implements ICanonicalDatabaseStorageEngine {
  private readonly storageKey: string;

  constructor(storageKey: string = 'autonomous_execution_canonical_db_v1') {
    this.storageKey = storageKey;
  }

  async loadData(): Promise<CanonicalDatabaseSchema | null> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          return JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn('Failed to load canonical db from localStorage:', e);
    }
    return null;
  }

  async saveData(data: CanonicalDatabaseSchema): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('Failed to save canonical db to localStorage:', e);
    }
  }

  async clear(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(this.storageKey);
      }
    } catch (e) {
      console.warn('Failed to clear canonical db from localStorage:', e);
    }
  }
}

/**
 * Create Empty Canonical Database Tables
 */
export function createEmptyCanonicalSchema(): CanonicalDatabaseSchema {
  return {
    profiles: [],
    routine_definitions: [],
    routine_versions: [],
    routine_steps: [],
    activity_definitions: [],
    activity_instances: [],
    allocations: [],
    allocation_conflicts: [],
    dependencies: [],
    fallback_policies: [],
    fallback_options: [],
    execution_sessions: [],
    execution_evidences: [],
    deviations: [],
    interventions: [],
    decision_contexts: [],
    decision_candidates: [],
    decisions: [],
    adaptation_patterns: [],
    adaptation_proposals: [],
    experiments: [],
    governance_policies: [],
    protected_commitments: [],
    overrides: [],
    event_records: [],
    reward_ledgers: [],
    reward_definitions: [],
    day_histories: [],
    legacy_raw_metadata: [],
  };
}

/**
 * Canonical Database: Multi-table relational database engine with strict concurrency & invariants
 */
export class CanonicalDatabase {
  private schema: CanonicalDatabaseSchema;
  private storageEngine: ICanonicalDatabaseStorageEngine;
  private isInitialized = false;

  constructor(
    storageEngine: ICanonicalDatabaseStorageEngine = new InMemoryCanonicalStorageEngine(),
    initialData?: CanonicalDatabaseSchema
  ) {
    this.storageEngine = storageEngine;
    this.schema = initialData ? JSON.parse(JSON.stringify(initialData)) : createEmptyCanonicalSchema();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    const loaded = await this.storageEngine.loadData();
    if (loaded) {
      this.schema = {
        ...createEmptyCanonicalSchema(),
        ...loaded,
      };
    }
    this.isInitialized = true;
  }

  async flush(): Promise<void> {
    await this.storageEngine.saveData(this.schema);
  }

  // --- Generic Table Operations ---

  async findById<T extends { id: string }>(table: TableName, id: string): Promise<T | null> {
    await this.initialize();
    const rows = this.schema[table] as unknown as T[];
    const found = rows.find(r => r.id === id);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  async findMany<T>(
    table: TableName,
    predicate?: (item: T) => boolean
  ): Promise<T[]> {
    await this.initialize();
    const rows = this.schema[table] as unknown as T[];
    const result = predicate ? rows.filter(predicate) : rows;
    return JSON.parse(JSON.stringify(result));
  }

  async insert<T extends { id: string }>(table: TableName, record: T): Promise<T> {
    await this.initialize();
    const rows = this.schema[table] as unknown as T[];
    const existing = rows.find(r => r.id === record.id);
    if (existing) {
      throw new InvariantViolationError(`Record with id ${record.id} already exists in ${table}`);
    }

    const toInsert = { ...record };
    // Initialize version if VersionedEntity
    if ('version' in (toInsert as any) && typeof (toInsert as any).version !== 'number') {
      (toInsert as any).version = 1;
    }
    const nowUtc = new Date().toISOString();
    if ('createdAtUtc' in (toInsert as any) && !(toInsert as any).createdAtUtc) {
      (toInsert as any).createdAtUtc = nowUtc;
    }
    if ('updatedAtUtc' in (toInsert as any) && !(toInsert as any).updatedAtUtc) {
      (toInsert as any).updatedAtUtc = nowUtc;
    }

    rows.push(toInsert);
    await this.flush();
    return JSON.parse(JSON.stringify(toInsert));
  }

  async insertMany<T extends { id: string }>(table: TableName, records: T[]): Promise<void> {
    await this.initialize();
    const rows = this.schema[table] as unknown as T[];
    const nowUtc = new Date().toISOString();

    for (const record of records) {
      const idx = rows.findIndex(r => r.id === record.id);
      const toInsert = { ...record };
      if ('version' in (toInsert as any) && typeof (toInsert as any).version !== 'number') {
        (toInsert as any).version = 1;
      }
      if ('createdAtUtc' in (toInsert as any) && !(toInsert as any).createdAtUtc) {
        (toInsert as any).createdAtUtc = nowUtc;
      }
      if ('updatedAtUtc' in (toInsert as any) && !(toInsert as any).updatedAtUtc) {
        (toInsert as any).updatedAtUtc = nowUtc;
      }

      if (idx >= 0) {
        rows[idx] = toInsert;
      } else {
        rows.push(toInsert);
      }
    }
    await this.flush();
  }

  /**
   * Concurrency-checked update: If expectedVersion is supplied, verifies version equality before updating.
   * Increments version automatically.
   */
  async update<T extends { id: string }>(
    table: TableName,
    id: string,
    mutator: (current: T) => T | void,
    expectedVersion?: number
  ): Promise<T> {
    await this.initialize();
    const rows = this.schema[table] as unknown as T[];
    const idx = rows.findIndex(r => r.id === id);
    if (idx < 0) {
      throw new EntityNotFoundError(table, id);
    }

    const current = rows[idx];

    // Concurrency Check
    if (expectedVersion !== undefined && 'version' in (current as any)) {
      const currentVer = (current as any).version;
      if (currentVer !== expectedVersion) {
        throw new OptimisticLockError(table, id, expectedVersion, currentVer);
      }
    }

    const cloned = JSON.parse(JSON.stringify(current)) as T;
    const modified = mutator(cloned) || cloned;

    // Automatic version bump & timestamp update
    if ('version' in (modified as any)) {
      (modified as any).version = ((modified as any).version || 0) + 1;
    }
    if ('updatedAtUtc' in (modified as any)) {
      (modified as any).updatedAtUtc = new Date().toISOString();
    }

    rows[idx] = modified;
    await this.flush();
    return JSON.parse(JSON.stringify(modified));
  }

  async upsert<T extends { id: string }>(table: TableName, record: T): Promise<T> {
    await this.initialize();
    const rows = this.schema[table] as unknown as T[];
    const idx = rows.findIndex(r => r.id === record.id);
    const nowUtc = new Date().toISOString();
    const toSave = { ...record };

    if (idx >= 0) {
      const existing = rows[idx];
      if ('version' in (toSave as any)) {
        (toSave as any).version = ((existing as any).version || 0) + 1;
      }
      if ('createdAtUtc' in (toSave as any) && (existing as any).createdAtUtc) {
        (toSave as any).createdAtUtc = (existing as any).createdAtUtc;
      }
      if ('updatedAtUtc' in (toSave as any)) {
        (toSave as any).updatedAtUtc = nowUtc;
      }
      rows[idx] = toSave;
    } else {
      if ('version' in (toSave as any) && typeof (toSave as any).version !== 'number') {
        (toSave as any).version = 1;
      }
      if ('createdAtUtc' in (toSave as any) && !(toSave as any).createdAtUtc) {
        (toSave as any).createdAtUtc = nowUtc;
      }
      if ('updatedAtUtc' in (toSave as any) && !(toSave as any).updatedAtUtc) {
        (toSave as any).updatedAtUtc = nowUtc;
      }
      rows.push(toSave);
    }

    await this.flush();
    return JSON.parse(JSON.stringify(toSave));
  }

  async delete(table: TableName, id: string): Promise<boolean> {
    await this.initialize();
    const rows = this.schema[table] as unknown as { id: string }[];
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) {
      rows.splice(idx, 1);
      await this.flush();
      return true;
    }
    return false;
  }

  async count(table: TableName): Promise<number> {
    await this.initialize();
    return (this.schema[table] as unknown as any[]).length;
  }

  async clearTable(table: TableName): Promise<void> {
    await this.initialize();
    this.schema[table] = [] as any;
    await this.flush();
  }

  async clearAll(): Promise<void> {
    this.schema = createEmptyCanonicalSchema();
    await this.storageEngine.clear();
  }

  getSnapshot(): CanonicalDatabaseSchema {
    return JSON.parse(JSON.stringify(this.schema));
  }

  async restoreSnapshot(snapshot: CanonicalDatabaseSchema): Promise<void> {
    this.schema = JSON.parse(JSON.stringify(snapshot));
    await this.flush();
  }
}
