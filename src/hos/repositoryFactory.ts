import crypto from 'crypto';
import path from 'path';
import { IExecutionRepository } from '../repositories';
import { CanonicalDatabase } from '../canonical/canonicalDatabase';
import { FileCanonicalStorageEngine } from '../canonical/fileCanonicalStorageEngine';
import { ProductionExecutionRepository } from '../canonical/productionRepository';
import { HOSSubjectContext } from './identityBridge';

export interface IHOSRepositoryFactory {
  forSubject(subject: HOSSubjectContext): IExecutionRepository;
}

export class HOSSubjectScopedRepositoryFactory implements IHOSRepositoryFactory {
  private cache = new Map<string, IExecutionRepository>();
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || process.env.EXECUTION_OS_SUBJECT_DATA_DIR || path.join(process.cwd(), 'data', 'subjects');
  }

  private key(subject: HOSSubjectContext): string {
    return `${subject.tenantId}::${subject.subjectId}`;
  }

  private subjectFile(subject: HOSSubjectContext): string {
    const digest = crypto.createHash('sha256').update(this.key(subject)).digest('hex').slice(0, 24);
    return path.join(this.dataDir, `execution_subject_${digest}.json`);
  }

  forSubject(subject: HOSSubjectContext): IExecutionRepository {
    const key = this.key(subject);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const engine = new FileCanonicalStorageEngine({ filePath: this.subjectFile(subject) });
    const db = new CanonicalDatabase(engine);
    const repository = new ProductionExecutionRepository(db, subject.subjectId);
    this.cache.set(key, repository);
    return repository;
  }
}

export class StaticHOSRepositoryFactory implements IHOSRepositoryFactory {
  constructor(private repository: IExecutionRepository) {}
  forSubject(_subject: HOSSubjectContext): IExecutionRepository {
    return this.repository;
  }
}
