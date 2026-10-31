import crypto from 'crypto';
import { Request } from 'express';
import { AuthenticationError, AuthorizationError, SecurityIntegrityError } from '../server/errors';

export interface HOSSubjectContext {
  subjectId: string;
  hosUserId: string;
  tenantId: string;
  permissions: string[];
  consentScopes: string[];
  issuer: 'HumanKernelOS';
  authenticatedAtUtc: string;
}

export interface HOSIdentityAssertion {
  subjectId: string;
  tenantId: string;
  permissions: string[];
  consentScopes: string[];
  issuedAt: string;
}

const normalize = (items: string[]) => [...new Set(items.map(v => v.trim()).filter(Boolean))].sort();

export class HOSIdentityBridge {
  static readonly MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

  private static getSecret(): string {
    const secret = process.env.HOS_EXECUTION_SHARED_SECRET?.trim();
    if (!secret || secret.length < 32) {
      throw new SecurityIntegrityError(
        'HOS_EXECUTION_SHARED_SECRET must be configured with at least 32 characters before HOS identity assertions can be accepted.'
      );
    }
    return secret;
  }

  static canonicalPayload(assertion: HOSIdentityAssertion): string {
    return [
      assertion.subjectId,
      assertion.tenantId,
      normalize(assertion.permissions).join(','),
      normalize(assertion.consentScopes).join(','),
      assertion.issuedAt,
    ].join('|');
  }

  static signAssertion(assertion: HOSIdentityAssertion): string {
    return crypto
      .createHmac('sha256', this.getSecret())
      .update(this.canonicalPayload(assertion))
      .digest('hex');
  }

  static verifyAssertion(assertion: HOSIdentityAssertion, signature: string): HOSSubjectContext {
    if (!assertion.subjectId || !assertion.tenantId || !assertion.issuedAt || !signature) {
      throw new AuthenticationError('Incomplete HumanKernelOS identity assertion.');
    }

    const issuedAtMs = Date.parse(assertion.issuedAt);
    if (!Number.isFinite(issuedAtMs)) {
      throw new AuthenticationError('Invalid HumanKernelOS identity assertion timestamp.');
    }
    if (Math.abs(Date.now() - issuedAtMs) > this.MAX_CLOCK_SKEW_MS) {
      throw new AuthenticationError('HumanKernelOS identity assertion is expired or outside the allowed clock-skew window.');
    }

    const expected = this.signAssertion(assertion);
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new AuthenticationError('HumanKernelOS identity assertion signature verification failed.');
    }

    return {
      subjectId: assertion.subjectId,
      hosUserId: assertion.subjectId,
      tenantId: assertion.tenantId,
      permissions: normalize(assertion.permissions),
      consentScopes: normalize(assertion.consentScopes),
      issuer: 'HumanKernelOS',
      authenticatedAtUtc: new Date().toISOString(),
    };
  }

  static fromRequest(req: Request): HOSSubjectContext {
    const assertion: HOSIdentityAssertion = {
      subjectId: String(req.headers['x-hos-subject'] || ''),
      tenantId: String(req.headers['x-hos-tenant'] || ''),
      permissions: String(req.headers['x-hos-permissions'] || '').split(',').filter(Boolean),
      consentScopes: String(req.headers['x-hos-consent'] || '').split(',').filter(Boolean),
      issuedAt: String(req.headers['x-hos-issued-at'] || ''),
    };
    const signature = String(req.headers['x-hos-signature'] || '');
    return this.verifyAssertion(assertion, signature);
  }

  static requirePermission(context: HOSSubjectContext, permission: string): void {
    if (!context.permissions.includes(permission)) {
      throw new AuthorizationError(`HumanKernelOS subject "${context.subjectId}" lacks required permission "${permission}".`, {
        subjectId: context.subjectId,
        requiredPermission: permission,
      });
    }
  }

  static requireConsent(context: HOSSubjectContext, consentScope: string): void {
    if (!context.consentScopes.includes(consentScope)) {
      throw new AuthorizationError(`HumanKernelOS subject "${context.subjectId}" has not granted consent scope "${consentScope}".`, {
        subjectId: context.subjectId,
        requiredConsentScope: consentScope,
      });
    }
  }
}
