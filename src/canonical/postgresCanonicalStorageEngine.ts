import { Pool, PoolConfig, QueryResult } from 'pg';
import {
  CanonicalDatabaseSchema,
  ICanonicalDatabaseStorageEngine,
} from './canonicalDatabase';

export type ExecutionPersistenceMode = 'file' | 'postgres';

export interface PostgresQueryable {
  query(text: string, values?: any[]): Promise<QueryResult<any>>;
}

export interface PostgresCanonicalStorageOptions {
  tenantId: string;
  subjectId: string;
  connectionString?: string;
  pool?: PostgresQueryable;
  autoMigrate?: boolean;
}

const pools = new Map<string, Pool>();

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getExecutionPersistenceMode(): ExecutionPersistenceMode {
  const configured = String(process.env.EXECUTION_OS_PERSISTENCE || '').trim().toLowerCase();
  if (configured === 'postgres' || configured === 'file') return configured;
  return process.env.DATABASE_URL ? 'postgres' : 'file';
}

function resolveSslConfig(): PoolConfig['ssl'] {
  const mode = String(process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (mode === 'disable' || mode === 'false' || (!mode && process.env.NODE_ENV !== 'production')) {
    return false;
  }

  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(ca ? { ca } : {}),
  };
}

export function getSharedPostgresPool(connectionString = process.env.DATABASE_URL || ''): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when Execution OS persistence is PostgreSQL.');
  }

  const key = [
    connectionString,
    String(process.env.DATABASE_SSL || ''),
    String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || ''),
  ].join('|');

  const existing = pools.get(key);
  if (existing) return existing;

  const pool = new Pool({
    connectionString,
    ssl: resolveSslConfig(),
    max: positiveInteger(process.env.EXECUTION_OS_PG_POOL_MAX, 10),
    idleTimeoutMillis: positiveInteger(process.env.EXECUTION_OS_PG_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: positiveInteger(process.env.EXECUTION_OS_PG_CONNECTION_TIMEOUT_MS, 5000),
    application_name: 'execution-os',
  });
  pools.set(key, pool);
  return pool;
}

export class PostgresCanonicalStorageEngine implements ICanonicalDatabaseStorageEngine {
  private readonly tenantId: string;
  private readonly subjectId: string;
  private readonly pool: PostgresQueryable;
  private readonly autoMigrate: boolean;
  private schemaReady: Promise<void> | null = null;

  constructor(options: PostgresCanonicalStorageOptions) {
    this.tenantId = options.tenantId?.trim();
    this.subjectId = options.subjectId?.trim();
    if (!this.tenantId || !this.subjectId) {
      throw new Error('PostgreSQL canonical persistence requires tenantId and subjectId.');
    }
    this.pool = options.pool || getSharedPostgresPool(options.connectionString);
    this.autoMigrate = options.autoMigrate !== false;
  }

  private async ensureSchema(): Promise<void> {
    if (!this.autoMigrate) return;
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS execution_os_subject_state (
            tenant_id TEXT NOT NULL,
            subject_id TEXT NOT NULL,
            state JSONB NOT NULL,
            revision BIGINT NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (tenant_id, subject_id)
          )
        `);
        await this.pool.query(`
          CREATE INDEX IF NOT EXISTS idx_execution_os_subject_state_updated_at
          ON execution_os_subject_state (updated_at DESC)
        `);
      })().catch(error => {
        this.schemaReady = null;
        throw error;
      });
    }
    return this.schemaReady;
  }

  async loadData(): Promise<CanonicalDatabaseSchema | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      'SELECT state FROM execution_os_subject_state WHERE tenant_id = $1 AND subject_id = $2 LIMIT 1',
      [this.tenantId, this.subjectId]
    );
    if (!result.rows.length) return null;
    const value = result.rows[0].state;
    return typeof value === 'string' ? JSON.parse(value) : JSON.parse(JSON.stringify(value));
  }

  async saveData(data: CanonicalDatabaseSchema): Promise<void> {
    await this.ensureSchema();
    const payload = JSON.stringify(data);
    await this.pool.query(
      `INSERT INTO execution_os_subject_state (tenant_id, subject_id, state)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, subject_id)
       DO UPDATE SET
         state = EXCLUDED.state,
         revision = execution_os_subject_state.revision + 1,
         updated_at = NOW()`,
      [this.tenantId, this.subjectId, payload]
    );
  }

  async clear(): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      'DELETE FROM execution_os_subject_state WHERE tenant_id = $1 AND subject_id = $2',
      [this.tenantId, this.subjectId]
    );
  }

  async healthCheck(): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('SELECT 1 AS ok');
  }
}

export async function assertPostgresRuntimeReady(): Promise<void> {
  if (getExecutionPersistenceMode() !== 'postgres') return;
  const engine = new PostgresCanonicalStorageEngine({
    tenantId: '__runtime__',
    subjectId: '__health__',
  });
  await engine.healthCheck();
}
