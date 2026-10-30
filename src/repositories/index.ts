export * from './interfaces';
export * from './implementations';
export * from '../canonical';

import { LocalExecutionRepository, InMemoryExecutionRepository, CompositeExecutionRepository } from './implementations';
import { ProductionExecutionRepository } from '../canonical/productionRepository';
import { CanonicalDatabase, InMemoryCanonicalStorageEngine, LocalStorageCanonicalEngine } from '../canonical/canonicalDatabase';
import { FileCanonicalStorageEngine } from '../canonical/fileCanonicalStorageEngine';
import { IExecutionRepository, IUnitOfWork } from './interfaces';
import { AppState } from '../types';

const isNodeEnvironment = typeof window === 'undefined' && typeof process !== 'undefined' && Boolean(process.versions?.node);

export const defaultExecutionRepository: IExecutionRepository = isNodeEnvironment
  ? new ProductionExecutionRepository(new CanonicalDatabase(new FileCanonicalStorageEngine()), 'user_primary')
  : new LocalExecutionRepository();

/**
 * Factory function to create execution repository / Unit of Work
 */
export function createExecutionRepository(
  type: 'local' | 'memory' | 'production' | 'production-memory' = 'local',
  initialState?: AppState
): IUnitOfWork & IExecutionRepository {
  switch (type) {
    case 'memory':
      return new InMemoryExecutionRepository(initialState);
    case 'production':
      return new ProductionExecutionRepository(
        new CanonicalDatabase(isNodeEnvironment ? new FileCanonicalStorageEngine() : new LocalStorageCanonicalEngine()),
        'user_primary',
        undefined,
        initialState
      );
    case 'production-memory':
      return new ProductionExecutionRepository(
        new CanonicalDatabase(new InMemoryCanonicalStorageEngine()),
        'user_primary',
        undefined,
        initialState
      );
    case 'local':
    default:
      return isNodeEnvironment
        ? new ProductionExecutionRepository(new CanonicalDatabase(new FileCanonicalStorageEngine()), 'user_primary', undefined, initialState)
        : new LocalExecutionRepository();
  }
}
