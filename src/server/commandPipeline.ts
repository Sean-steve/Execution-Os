import { Request, Response, NextFunction } from 'express';
import { AppState, SystemEvent } from '../types';
import { IExecutionRepository } from '../repositories';
import { IClock } from '../clock';
import { ICommand, CommandResult } from '../commands/types';
import { ExecutionApplicationService } from '../services/executionApplicationService';
import { defaultIdempotencyStore, IdempotencyStore } from './idempotency';
import { defaultDurableEventStore, IDurableEventStore } from '../services/durableEventStore';
import { defaultEventDispatcher, IdempotentEventDispatcher } from '../services/eventDispatcher';
import {
  ApiError,
  ValidationError,
  StaleVersionError,
  AuthorizationError,
  AuthenticationError,
  InternalError
} from './errors';

export interface CommandExecutionOptions {
  repository: IExecutionRepository;
  clock?: IClock;
  idempotencyStore?: IdempotencyStore;
  eventStore?: IDurableEventStore;
  eventDispatcher?: IdempotentEventDispatcher;
}

export interface ApiSuccessResponse<TData = any> {
  success: true;
  data?: TData;
  state: AppState;
  events: SystemEvent[];
  version: number;
  metadata: {
    requestId: string;
    timestamp: string;
    userId: string;
    idempotentReplay?: boolean;
  };
}

export async function processAuthoritativeCommand<TPayload = any, TResultData = any>(
  req: Request,
  res: Response,
  next: NextFunction,
  commandFactory: (state: AppState, user: any) => ICommand<TResultData>,
  options: CommandExecutionOptions
): Promise<void> {
  const requestId = req.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const idempotencyStore = options.idempotencyStore || defaultIdempotencyStore;

  try {
    // -------------------------------------------------------------
    // 1. AUTHENTICATE
    // -------------------------------------------------------------
    const user = req.user;
    if (!user || !user.userId) {
      throw new AuthenticationError('User identity must be authenticated.');
    }

    // -------------------------------------------------------------
    // 2. AUTHORIZE
    // -------------------------------------------------------------
    if (user.role === 'READONLY' || !user.permissions.includes('write:execution')) {
      throw new AuthorizationError('User lacks write:execution permissions.');
    }

    // -------------------------------------------------------------
    // 3. IDEMPOTENCY CHECK
    // -------------------------------------------------------------
    const idempotencyKey =
      (req.headers['idempotency-key'] as string) ||
      (req.headers['x-idempotency-key'] as string) ||
      req.body?.idempotencyKey;

    if (idempotencyKey) {
      const cached = idempotencyStore.get(idempotencyKey);
      if (cached) {
        res.status(cached.statusCode);
        Object.entries(cached.headers).forEach(([k, v]) => res.setHeader(k, v));
        res.setHeader('X-Idempotent-Replay', 'true');
        res.json({
          ...cached.body,
          metadata: {
            ...cached.body.metadata,
            idempotentReplay: true,
          },
        });
        return;
      }
    }

    // -------------------------------------------------------------
    // 4. LOAD CURRENT AGGREGATE STATE
    // -------------------------------------------------------------
    const appService = new ExecutionApplicationService(options.repository, options.clock);
    const currentState = await options.repository.loadState();

    // -------------------------------------------------------------
    // 5. AGGREGATE VERSION & OPTIMISTIC LOCK CHECK
    // -------------------------------------------------------------
    const ifMatchHeader = req.headers['if-match'];
    const expectedVersionFromBody = req.body?.expectedVersion;
    const expectedVersion = ifMatchHeader ? parseInt(ifMatchHeader, 10) : expectedVersionFromBody;

    const currentVersion = (currentState as any).version || 1;
    if (expectedVersion !== undefined && !isNaN(expectedVersion)) {
      if (expectedVersion !== currentVersion) {
        throw new StaleVersionError(
          `Version conflict: Expected aggregate version ${expectedVersion}, but current database version is ${currentVersion}.`,
          { expectedVersion, currentVersion }
        );
      }
    }

    // -------------------------------------------------------------
    // 6. INSTANTIATE COMMAND & PRE-EXECUTION VALIDATION
    // -------------------------------------------------------------
    const command = commandFactory(currentState, user);

    // -------------------------------------------------------------
    // 7. EXECUTE DOMAIN COMMAND (includes domain validation & governance)
    // -------------------------------------------------------------
    const result: CommandResult<TResultData> = await appService.dispatch(command, currentState);

    if (!result.success) {
      const errorMsg = result.error || 'Command execution failed in domain pipeline.';
      if (errorMsg.includes('Governance') || errorMsg.includes('Protected Family')) {
        throw new ApiError('GOVERNANCE_DENIED', errorMsg, 403);
      } else if (errorMsg.includes('Trading Gatekeeper') || errorMsg.includes('Market Analysis')) {
        throw new ApiError('TRADING_GATE_CLOSED', errorMsg, 422);
      } else if (errorMsg.includes('Dependencies not met') || errorMsg.includes('Dependency')) {
        throw new ApiError('DEPENDENCY_BLOCKED', errorMsg, 422);
      } else if (errorMsg.includes('Approval required') || errorMsg.includes('MANUAL autonomy')) {
        throw new ApiError('APPROVAL_REQUIRED', errorMsg, 422);
      } else if (errorMsg.includes('validation')) {
        throw new ValidationError(errorMsg);
      } else {
        throw new ApiError('CONFLICT', errorMsg, 409);
      }
    }

    // -------------------------------------------------------------
    // 8. PERSISTENCE & VERSION INCREMENT
    // -------------------------------------------------------------
    const nextVersion = currentVersion + 1;
    const nextState = {
      ...result.state,
      version: nextVersion,
      lastUpdatedAtUtc: new Date().toISOString(),
    };
    await options.repository.saveState(nextState);

    // -------------------------------------------------------------
    // 9. EMIT & PERSIST EVENTS DURABLY
    // -------------------------------------------------------------
    const eventStore = options.eventStore || defaultDurableEventStore;
    const eventDispatcher = options.eventDispatcher || defaultEventDispatcher;
    if (result.events && result.events.length > 0) {
      await eventStore.appendBatch(result.events);
      await eventDispatcher.dispatchBatch(result.events);
    }

    // -------------------------------------------------------------
    // 10. RETURN RESULTING STATE & CACHE IDEMPOTENCY
    // -------------------------------------------------------------
    const responsePayload: ApiSuccessResponse<TResultData> = {
      success: true,
      data: (result.data !== undefined ? result.data : nextState) as any,
      state: nextState,
      events: result.events,
      version: nextVersion,
      metadata: {
        requestId,
        timestamp: new Date().toISOString(),
        userId: user.userId,
      },
    };

    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, 200, responsePayload, {
        'Content-Type': 'application/json',
      });
    }

    res.setHeader('ETag', `"${nextVersion}"`);
    res.status(200).json(responsePayload);
  } catch (err: any) {
    next(err);
  }
}
