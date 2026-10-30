/**
 * Standardized Error Contract for Execution OS Backend APIs (EOS-004)
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_FAILED'
  | 'GOVERNANCE_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'DEPENDENCY_BLOCKED'
  | 'CONFLICT'
  | 'STALE_VERSION'
  | 'NO_FEASIBLE_ALLOCATION'
  | 'TRADING_GATE_CLOSED'
  | 'RESOURCE_NOT_FOUND'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SECURITY_INTEGRITY_VIOLATION'
  | 'INTERNAL_ERROR';

export interface StructuredErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, any>;

  constructor(code: ErrorCode, message: string, statusCode: number = 400, details?: Record<string, any>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(requestId?: string): StructuredErrorResponse & { code: ErrorCode; message: string; details?: Record<string, any>; success: boolean } {
    return {
      success: false,
      code: this.code,
      message: this.message,
      details: this.details,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        timestamp: new Date().toISOString(),
        requestId,
      },
    };
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, any>) {
    super('VALIDATION_FAILED', message, 400, details);
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication required', details?: Record<string, any>) {
    super('AUTHENTICATION_REQUIRED', message, 401, details);
  }
}

export class AuthorizationError extends ApiError {
  constructor(message: string = 'Authorization failed', details?: Record<string, any>) {
    super('AUTHORIZATION_FAILED', message, 403, details);
  }
}

export class GovernanceDeniedError extends ApiError {
  constructor(message: string = 'Governance policy denied request', details?: Record<string, any>) {
    super('GOVERNANCE_DENIED', message, 403, details);
  }
}

export class ApprovalRequiredError extends ApiError {
  constructor(message: string = 'Human approval is required to proceed', details?: Record<string, any>) {
    super('APPROVAL_REQUIRED', message, 422, details);
  }
}

export class DependencyBlockedError extends ApiError {
  constructor(message: string = 'Activity dependencies not satisfied', details?: Record<string, any>) {
    super('DEPENDENCY_BLOCKED', message, 422, details);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string = 'Resource conflict detected', details?: Record<string, any>) {
    super('CONFLICT', message, 409, details);
  }
}

export class StaleVersionError extends ApiError {
  constructor(message: string = 'Aggregate version is stale (optimistic lock conflict)', details?: Record<string, any>) {
    super('STALE_VERSION', message, 409, details);
  }
}

export class NoFeasibleAllocationError extends ApiError {
  constructor(message: string = 'No feasible allocation could be scheduled within constraints', details?: Record<string, any>) {
    super('NO_FEASIBLE_ALLOCATION', message, 422, details);
  }
}

export class TradingGateClosedError extends ApiError {
  constructor(message: string = 'Trading gatekeeper denied execution: prerequisites unmet', details?: Record<string, any>) {
    super('TRADING_GATE_CLOSED', message, 422, details);
  }
}

export class ResourceNotFoundError extends ApiError {
  constructor(message: string = 'Requested resource not found', details?: Record<string, any>) {
    super('RESOURCE_NOT_FOUND', message, 404, details);
  }
}

export class RateLimitExceededError extends ApiError {
  constructor(message: string = 'Too many requests. Rate limit exceeded.', details?: Record<string, any>) {
    super('RATE_LIMIT_EXCEEDED', message, 429, details);
  }
}

export class SecurityIntegrityError extends ApiError {
  constructor(message: string = 'Security integrity check failed: signature, tamper, or cross-tenant violation.', details?: Record<string, any>) {
    super('SECURITY_INTEGRITY_VIOLATION', message, 403, details);
  }
}

export class InternalError extends ApiError {
  constructor(message: string = 'Internal Execution OS server error', details?: Record<string, any>) {
    super('INTERNAL_ERROR', message, 500, details);
  }
}
