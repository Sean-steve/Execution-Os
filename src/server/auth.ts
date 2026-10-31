import { Request, Response, NextFunction } from 'express';
import { AuthenticationError, AuthorizationError } from './errors';
import { SecurityEngine, TokenClaims } from './security';
import { HOSIdentityBridge, HOSSubjectContext } from '../hos/identityBridge';

export interface UserContext {
  userId: string;
  tenantId: string;
  role: 'OWNER' | 'ADMIN' | 'READONLY';
  permissions: string[];
  tokenClaims?: TokenClaims;
  identitySource?: 'HOS' | 'LEGACY_STANDALONE' | 'PUBLIC';
  consentScopes?: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
      hosSubject?: HOSSubjectContext;
      idempotencyKey?: string;
      expectedVersion?: number;
      requestId?: string;
    }
  }
}

export type ExecutionIdentityMode = 'HOS' | 'LEGACY_STANDALONE';

export function getExecutionIdentityMode(): ExecutionIdentityMode {
  return process.env.EXECUTION_OS_IDENTITY_MODE === 'LEGACY_STANDALONE'
    ? 'LEGACY_STANDALONE'
    : 'HOS';
}

function isPublicPath(path: string, mode: ExecutionIdentityMode): boolean {
  const publicPaths = ['/api/health', '/health', '/api/v1/hos/manifest', '/api/v1/hos/health'];
  if (publicPaths.some(p => path === p || path.endsWith(p))) return true;
  return mode === 'LEGACY_STANDALONE' && path.endsWith('/api/v1/hee/auth/token');
}

function mapHOSPermissionsToLegacy(permissions: string[]): string[] {
  const mapped = new Set(permissions);
  if (permissions.some(p => p.endsWith('.read') || p.includes('.read.'))) mapped.add('read:execution');
  if (permissions.some(p => p.endsWith('.write') || p.includes('.write.'))) mapped.add('write:execution');
  if (permissions.includes('execution.governance.write')) mapped.add('manage:governance');
  if (permissions.includes('execution.override.emergency')) mapped.add('override:emergency');
  return [...mapped];
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const mode = getExecutionIdentityMode();
  const path = req.path;

  if (isPublicPath(path, mode)) {
    req.user = {
      userId: 'public',
      tenantId: 'public',
      role: 'READONLY',
      permissions: ['read:public'],
      identitySource: 'PUBLIC',
      consentScopes: [],
    };
    return next();
  }

  if (mode === 'HOS') {
    try {
      const subject = HOSIdentityBridge.fromRequest(req);
      req.hosSubject = subject;

      if (path.startsWith('/api/v1/hee/') && !subject.permissions.includes('execution.legacy.api')) {
        return next(new AuthorizationError(
          'Direct legacy HEE API access is disabled for HOS subjects. Use the HOS engine capability contract.',
          { requiredPermission: 'execution.legacy.api', path }
        ));
      }

      req.user = {
        userId: subject.subjectId,
        tenantId: subject.tenantId,
        role: 'OWNER',
        permissions: mapHOSPermissionsToLegacy(subject.permissions),
        identitySource: 'HOS',
        consentScopes: subject.consentScopes,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  }

  // Explicit legacy compatibility mode only. This path is never the default runtime identity authority.
  const isProduction = process.env.NODE_ENV === 'production';
  const authHeader = req.headers.authorization;
  const customUserId = req.headers['x-user-id'] as string | undefined;
  const customTenantId = (req.headers['x-tenant-id'] as string | undefined) || 'tenant-standalone';

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
      if (customTenantId && customTenantId !== 'tenant-standalone' && claims.tenantId !== customTenantId) {
        return next(new AuthorizationError(
          `Cross-tenant security violation: Token belongs to tenant "${claims.tenantId}", not "${customTenantId}".`
        ));
      }
      if (customUserId && customUserId !== claims.sub) {
        return next(new AuthorizationError(
          `Cross-user access denied: Authenticated identity "${claims.sub}" cannot act on behalf of "${customUserId}".`
        ));
      }

      req.user = {
        userId: claims.sub,
        tenantId: claims.tenantId,
        role: claims.role,
        permissions: claims.permissions,
        tokenClaims: claims,
        identitySource: 'LEGACY_STANDALONE',
        consentScopes: [],
      };
      return next();
    } catch (err: any) {
      return next(new AuthenticationError(`Session token verification failed: ${err.message}`));
    }
  }

  if (isProduction) {
    return next(new AuthenticationError('Authentication required: Missing Authorization header in production standalone mode.'));
  }

  const userId = customUserId || 'standalone-test-subject';
  const role = (req.headers['x-user-role'] as any) || 'OWNER';
  req.user = {
    userId,
    tenantId: customTenantId,
    role,
    permissions: role === 'READONLY'
      ? ['read:execution']
      : ['read:execution', 'write:execution', 'manage:governance', 'override:emergency'],
    identitySource: 'LEGACY_STANDALONE',
    consentScopes: [],
  };
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AuthenticationError('Authentication required to verify permissions'));
    if (!req.user.permissions.includes(permission)) {
      return next(new AuthorizationError(
        `User "${req.user.userId}" lacks required permission: "${permission}"`,
        { requiredPermission: permission, userRole: req.user.role, userPermissions: req.user.permissions }
      ));
    }
    next();
  };
}

export function requireOwnership(getOwnerId: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AuthenticationError('Authentication required'));
    const targetOwnerId = getOwnerId(req);
    if (!targetOwnerId) return next();
    if (req.user.role !== 'ADMIN' && req.user.userId !== targetOwnerId) {
      return next(new AuthorizationError(
        `Access Denied: Caller "${req.user.userId}" does not own resource owned by "${targetOwnerId}"`,
        { callerUserId: req.user.userId, resourceOwnerId: targetOwnerId }
      ));
    }
    next();
  };
}
