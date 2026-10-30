import { AppState } from '../types';
import { DEFAULT_APP_STATE } from '../data/defaultData';
import {
  type IExecutionRepository,
  LocalStorageExecutionRepository,
  InMemoryExecutionRepository,
  defaultExecutionRepository
} from '../repositories';

export type { IExecutionRepository };
export {
  LocalStorageExecutionRepository,
  InMemoryExecutionRepository
};

export const defaultRepository: IExecutionRepository = defaultExecutionRepository;
