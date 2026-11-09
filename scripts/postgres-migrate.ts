import fs from 'fs/promises';
import path from 'path';
import { getSharedPostgresPool } from '../src/canonical/postgresCanonicalStorageEngine';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run PostgreSQL migrations.');
  }
  const migrationPath = path.join(process.cwd(), 'migrations', '001_execution_os_postgres.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');
  const pool = getSharedPostgresPool();
  await pool.query(sql);
  console.log('[Execution OS] PostgreSQL migration 001 applied successfully.');
  await pool.end();
}

main().catch(error => {
  console.error('[Execution OS] PostgreSQL migration failed:', error);
  process.exitCode = 1;
});
