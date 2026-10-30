import { CanonicalDatabase, CanonicalDatabaseSchema } from './canonicalDatabase';
import { IStorageAdapter } from '../repositories/interfaces';
import { BrowserLocalStorageAdapter } from '../repositories/implementations';

export interface ExportDataPackage {
  formatVersion: '1.0.0';
  exportedAtUtc: string;
  schemaVersion: number;
  environment: string;
  totalRecordsCount: number;
  data: CanonicalDatabaseSchema;
  checksum: string;
}

export class ExportRollbackManager {
  constructor(
    private db: CanonicalDatabase,
    private storageAdapter: IStorageAdapter = new BrowserLocalStorageAdapter()
  ) {}

  /**
   * Generates a portable JSON export package with integrity checksum
   */
  async exportPackage(): Promise<ExportDataPackage> {
    await this.db.initialize();
    const snapshot = this.db.getSnapshot();
    let totalCount = 0;
    for (const key of Object.keys(snapshot) as (keyof CanonicalDatabaseSchema)[]) {
      totalCount += (snapshot[key] || []).length;
    }

    const payload = JSON.stringify(snapshot);
    // Simple fast DJB2 hash checksum
    let hash = 5381;
    for (let i = 0; i < payload.length; i++) {
      hash = (hash * 33) ^ payload.charCodeAt(i);
    }
    const checksum = (hash >>> 0).toString(16);

    return {
      formatVersion: '1.0.0',
      exportedAtUtc: new Date().toISOString(),
      schemaVersion: 1,
      environment: 'autonomous-execution-os',
      totalRecordsCount: totalCount,
      data: snapshot,
      checksum,
    };
  }

  /**
   * Imports a data package into canonical database, creating an automatic rollback snapshot beforehand
   */
  async importPackage(pkg: ExportDataPackage | string): Promise<{ success: boolean; rollbackKey: string }> {
    const parsed: ExportDataPackage = typeof pkg === 'string' ? JSON.parse(pkg) : pkg;
    if (!parsed.data || parsed.formatVersion !== '1.0.0') {
      throw new Error('Invalid export data package format');
    }

    await this.db.initialize();
    const currentSnapshot = this.db.getSnapshot();
    const rollbackKey = `rollback_snapshot_${Date.now()}`;

    // Save rollback snapshot
    this.storageAdapter.setItem(rollbackKey, JSON.stringify(currentSnapshot));

    // Restore new data
    await this.db.restoreSnapshot(parsed.data);

    return {
      success: true,
      rollbackKey,
    };
  }

  /**
   * Restores database state from a rollback key
   */
  async rollback(rollbackKey: string): Promise<boolean> {
    const raw = this.storageAdapter.getItem(rollbackKey);
    if (!raw) {
      throw new Error(`Rollback snapshot ${rollbackKey} not found`);
    }

    const snapshot = JSON.parse(raw);
    await this.db.initialize();
    await this.db.restoreSnapshot(snapshot);
    return true;
  }
}
