import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError, SecurityIntegrityError } from './errors';
import { SecurityEngine, TokenClaims } from './security';

export interface UserContext {
  userId: string;
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'READONLY';
  permissions: string[];
  tokenClaims?: TokenClaims;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
      idempotencyKey?: string;
      expectedVersion?: number;
      requestId?: string;
    }
  }
}

/**
 * Public routes that do not require authentication tokens
 */
const PUBLIC_PATHS = [
  '/api/health',
  '/health',
  '/api/v1/hee/auth/token',
];

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const path = req.path;

  // Allow public endpoints
  if (PUBLIC_PATHS.some(p => path === p || path.endsWith(p))) {
    req.user = {
      userId: 'anonymous',
      tenantId: 'tenant-default',
      role: 'READONLY',
      permissions: ['read:public'],
    };
    return next();
  }

  const authHeader = req.headers.authorization;
  const customUserId = req.headers['x-user-id'] as string | undefined;
  const customTenantId = (req.headers['x-tenant-id'] as string | undefined) || 'tenant-default';

  // 1. Bearer Token Authentication
  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) {
      return next(new AuthenticationError('Invalid Authorization header format. Expected "Bearer <token>".'));
    }
    const token = authHeader.substring(7).trim();
    if (!token || token === 'invalid_token' || token === 'expired_token') {
      return next(new AuthenticationError('Provided authentication token is invalid or expired.'));
    }

    try {
      const claims = SecurityEngine.verifySessionToken(token);
      
      // Prevent cross-tenant data access if client specifies mismatched tenant
      if (customTenantId && customTenantId !== 'tenant-default' && claims.tenantId !== customTenantId) {
        return next(
          new AuthorizationError(`Cross-tenant security violation: Token belongs to tenant "${claims.tenantId}", not "${customTenantId}".`, {
            tokenTenant: claims.tenantId,
            requestedTenant: customTenantId,
          })
        );
      }

      // Prevent cross-user data access if x-user-id header does not match authenticated subject
      if (customUserId && customUserId !== claims.sub) {
        return next(
          new AuthorizationError(`Cross-user access denied: Authenticated identity "${claims.sub}" cannot act on behalf of "${customUserId}".`, {
            authenticatedUserId: claims.sub,
            requestedUserId: customUserId,
          })
        );
      }

      req.user = {
        userId: claims.sub,
        tenantId: claims.tenantId,
        role: claims.role,
        permissions: claims.permissions,
        tokenClaims: claims,
      };
      return next();
    } catch (err: any) {
      return next(new AuthenticationError(`Session token verification failed: ${err.message}`));
    }
  }

  // 2. Production Fail Closed: If production and no Authorization header, strictly reject
  if (isProduction) {
    return next(
      new AuthenticationError('Authentication required: Missing Authorization header in production mode. Access denied.')
    );
  }

  // 3. Development / Test Fallback Context (NODE_ENV !== 'production')
  const userId = customUserId || 'user-default-1';
  const role = (req.headers['x-user-role'] as any) || 'OWNER';

  req.user = {
    userId,
    tenantId: customTenantId,
    role,
    permissions: role === 'READONLY' ? ['read:execution'] : ['read:execution', 'write:execution', 'manage:governance', 'override:emergency'],
  };

  next();
}

/**
 * Middleware ensuring current user possesses a specific permission
 */
export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required to verify permissions'));
    }
    if (!req.user.permissions.includes(permission)) {
      return next(new AuthorizationError(`User "${req.user.userId}" lacks required permission: "${permission}"`, {
        requiredPermission: permission,
        userRole: req.user.role,
        userPermissions: req.user.permissions,
      }));
    }
    next();
  };
}

/**
 * Middleware enforcing that the resource or target user matches the authenticated caller (Ownership Validation)
 */
export function requireOwnership(getOwnerId: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }
    const targetOwnerId = getOwnerId(req);
    if (!targetOwnerId) return next();

    if (req.user.role !== 'ADMIN' && req.user.userId !== targetOwnerId) {
      return next(
        new AuthorizationError(`Access Denied: Caller "${req.user.userId}" does not own resource owned by "${targetOwnerId}"`, {
          callerUserId: req.user.userId,
          resourceOwnerId: targetOwnerId,
        })
      );
    }
    next();
  };
}
