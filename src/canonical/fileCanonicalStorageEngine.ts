import { ICanonicalDatabaseStorageEngine, CanonicalDatabaseSchema, createEmptyCanonicalSchema } from './canonicalDatabase';
import path from 'path';

export interface FileStorageOptions {
  filePath?: string;
  backupDir?: string;
  autoFlush?: boolean;
}

/**
 * FileCanonicalStorageEngine
 * Durable, ACID-compliant, crash-resilient file storage engine for Execution OS.
 * Uses atomic rename patterns (write to .tmp then rename) to prevent database corruption.
 */
export class FileCanonicalStorageEngine implements ICanonicalDatabaseStorageEngine {
  private filePath: string;
  private backupDir: string;
  private memoryCache: CanonicalDatabaseSchema | null = null;
  private isFsAvailable: boolean = false;
  private fs: typeof import('fs/promises') | null = null;
  private fsSync: typeof import('fs') | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(options: FileStorageOptions = {}) {
    const cwd = (typeof process !== 'undefined' && typeof process.cwd === 'function') ? process.cwd() : '.';
    const defaultPath = (typeof process !== 'undefined' && process.env?.HEE_DATABASE_PATH) || (path?.join ? path.join(cwd, 'data', 'canonical_execution_db.json') : `${cwd}/data/canonical_execution_db.json`);
    this.filePath = options.filePath || defaultPath;
    this.backupDir = options.backupDir || (path?.join && path?.dirname ? path.join(path.dirname(this.filePath), 'backups') : `${cwd}/data/backups`);

    try {
      // Dynamic import check for Node.js environment
      if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node && typeof require === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        this.fsSync = require('fs');
        this.fs = require('fs').promises;
        this.isFsAvailable = true;
      }
    } catch (e) {
      this.isFsAvailable = false;
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public isNodeFsAvailable(): boolean {
    return this.isFsAvailable;
  }

  private async ensureDirectory(): Promise<void> {
    if (!this.isFsAvailable || !this.fs) return;
    const dir = path.dirname(this.filePath);
    try {
      await this.fs.mkdir(dir, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async loadData(): Promise<CanonicalDatabaseSchema | null> {
    if (this.memoryCache) {
      return JSON.parse(JSON.stringify(this.memoryCache));
    }

    if (!this.isFsAvailable || !this.fs || !this.fsSync) {
      // Browser fallback
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const raw = window.localStorage.getItem('hee_canonical_file_db');
          if (raw) {
            this.memoryCache = JSON.parse(raw);
            return JSON.parse(JSON.stringify(this.memoryCache));
          }
        } catch (e) {}
      }
      return null;
    }

    try {
      await this.ensureDirectory();
      if (!this.fsSync.existsSync(this.filePath)) {
        return null;
      }

      const content = await this.fs.readFile(this.filePath, 'utf-8');
      if (!content || content.trim() === '') {
        return null;
      }

      const parsed = JSON.parse(content) as CanonicalDatabaseSchema;
      this.memoryCache = parsed;
      return JSON.parse(JSON.stringify(parsed));
    } catch (err: any) {
      console.error(`[FileCanonicalStorageEngine] Failed to load database file at ${this.filePath}:`, err);
      return null;
    }
  }

  async saveData(data: CanonicalDatabaseSchema): Promise<void> {
    this.memoryCache = JSON.parse(JSON.stringify(data));

    if (!this.isFsAvailable || !this.fs) {
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem('hee_canonical_file_db', JSON.stringify(data));
        } catch (e) {}
      }
      return;
    }

    // Atomic write serialized under writeLock
    this.writeLock = this.writeLock.then(async () => {
      await this.ensureDirectory();
      const tmpPath = `${this.filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
      const jsonContent = JSON.stringify(data, null, 2);

      try {
        await this.fs!.writeFile(tmpPath, jsonContent, 'utf-8');
        await this.fs!.rename(tmpPath, this.filePath);
      } catch (err: any) {
        // Clean up temp file on failure if exists
        try {
          if (this.fsSync?.existsSync(tmpPath)) {
            await this.fs!.unlink(tmpPath);
          }
        } catch (e) {}
        throw new Error(`[FileCanonicalStorageEngine] Atomic file write failed: ${err.message}`);
      }
    });

    await this.writeLock;
  }

  async clear(): Promise<void> {
    this.memoryCache = null;

    if (!this.isFsAvailable || !this.fs || !this.fsSync) {
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.removeItem('hee_canonical_file_db');
        } catch (e) {}
      }
      return;
    }

    this.writeLock = this.writeLock.then(async () => {
      try {
        if (this.fsSync!.existsSync(this.filePath)) {
          await this.fs!.unlink(this.filePath);
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    });

    await this.writeLock;
  }

  /**
   * Creates a timestamped durable snapshot/backup of the database file
   */
  async createBackup(customBackupPath?: string): Promise<string> {
    await this.ensureDirectory();
    if (!this.isFsAvailable || !this.fs || !this.fsSync) {
      throw new Error('Backup creation requires Node.js filesystem environment.');
    }

    if (!this.fsSync.existsSync(this.filePath)) {
      const empty = createEmptyCanonicalSchema();
      await this.saveData(empty);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetDir = this.backupDir;
    await this.fs.mkdir(targetDir, { recursive: true });

    const backupFile = customBackupPath || path.join(targetDir, `canonical_backup_${timestamp}.json`);
    await this.fs.copyFile(this.filePath, backupFile);
    return backupFile;
  }

  /**
   * Restores database state from a backup file
   */
  async restoreFromBackup(backupFilePath: string): Promise<CanonicalDatabaseSchema> {
    if (!this.isFsAvailable || !this.fs || !this.fsSync) {
      throw new Error('Backup restoration requires Node.js filesystem environment.');
    }

    if (!this.fsSync.existsSync(backupFilePath)) {
      throw new Error(`Backup file does not exist: ${backupFilePath}`);
    }

    const content = await this.fs.readFile(backupFilePath, 'utf-8');
    const data = JSON.parse(content) as CanonicalDatabaseSchema;
    await this.saveData(data);
    return data;
  }
}
