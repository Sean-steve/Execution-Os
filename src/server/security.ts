/**
 * Execution OS Cryptographic Token & Secret Management Engine (EOS-007)
 * Implements HMAC-SHA256 authenticated sessions, tamper-proof state hashes,
 * payload signing, and multi-tenant security verification.
 */

import crypto from 'crypto';
import { SecurityIntegrityError } from './errors';

export interface TokenClaims {
  sub: string; // User ID
  tenantId: string; // Tenant / Organization ID
  role: 'OWNER' | 'ADMIN' | 'READONLY';
  permissions: string[];
  iat: number; // Issued at (seconds)
  exp: number; // Expiration (seconds)
  nonce?: string;
}

export class SecurityEngine {
  private static customSecretKey: string | null = null;
  private static devFallbackSecret: string = 'hee-authoritative-governance-master-secret-key-32b';

  /**
   * Retrieves the authoritative secret key with strict fail-closed production semantics.
   */
  public static getMasterSecretKey(): string {
    if (this.customSecretKey) {
      return this.customSecretKey;
    }

    const envSecret = process.env.HEE_SECURITY_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      if (!envSecret || envSecret.trim().length < 32) {
        throw new SecurityIntegrityError(
          'CRITICAL PRODUCTION SECURITY ERROR: HEE_SECURITY_SECRET must be configured and be at least 32 characters in production mode.'
        );
      }
      return envSecret.trim();
    }

    return envSecret?.trim() || this.devFallbackSecret;
  }

  /**
   * Allows setting an explicit secret key (e.g. for testing / rotation)
   */
  public static setMasterSecretKey(secret: string | null): void {
    this.customSecretKey = secret;
  }

  /**
   * Validates production security configuration on startup
   */
  public static validateProductionConfig(): { valid: boolean; message: string } {
    try {
      const secret = this.getMasterSecretKey();
      if (!secret || secret.length < 32) {
        return { valid: false, message: 'Secret key length is below 32 characters.' };
      }
      return { valid: true, message: 'Security secret is valid and secure.' };
    } catch (err: any) {
      return { valid: false, message: err.message };
    }
  }

  /**
   * Generates a signed, tamper-evident JWT-like session token
   */
  static generateSessionToken(
    userId: string,
    role: 'OWNER' | 'ADMIN' | 'READONLY' = 'OWNER',
    tenantId: string = 'tenant-default',
    durationSeconds: number = 86400,
    customPermissions?: string[]
  ): string {
    const defaultPerms =
      role === 'READONLY'
        ? ['read:execution']
        : ['read:execution', 'write:execution', 'manage:governance', 'override:emergency'];

    const claims: TokenClaims = {
      sub: userId,
      tenantId,
      role,
      permissions: customPermissions || defaultPerms,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + durationSeconds,
      nonce: crypto.randomBytes(8).toString('hex'),
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'HEE_JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const secret = this.getMasterSecretKey();
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  /**
   * Verifies and decodes a signed session token. Throws if invalid, expired, or tampered with.
   */
  static verifySessionToken(token: string): TokenClaims {
    if (!token || typeof token !== 'string') {
      throw new Error('Missing or malformed token string');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token structure. Expected header.payload.signature format.');
    }

    const [headerB64, payloadB64, signature] = parts;
    const secret = this.getMasterSecretKey();
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    // Constant-time comparison to prevent timing attacks
    const sigA = Buffer.from(signature, 'base64url');
    const sigB = Buffer.from(expectedSignature, 'base64url');
    if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
      throw new Error('Cryptographic signature verification failed: Token has been forged or tampered with.');
    }

    const claims: TokenClaims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (claims.exp && claims.exp < nowSeconds) {
      throw new Error(`Token expired at ${new Date(claims.exp * 1000).toISOString()}`);
    }

    return claims;
  }

  /**
   * Signs an override payload with HMAC-SHA256 signature to guarantee server-verified integrity
   */
  static signOverridePayload(overrideData: {
    userId: string;
    overrideType: string;
    reason: string;
    targetTaskId?: string;
    targetMode?: string;
    timestamp: string;
  }): string {
    const dataString = JSON.stringify({
      userId: overrideData.userId,
      overrideType: overrideData.overrideType,
      reason: overrideData.reason.trim(),
      targetTaskId: overrideData.targetTaskId || '',
      targetMode: overrideData.targetMode || '',
      timestamp: overrideData.timestamp,
    });

    const secret = this.getMasterSecretKey();
    return crypto
      .createHmac('sha256', secret)
      .update(dataString)
      .digest('hex');
  }

  /**
   * Verifies an override signature
   */
  static verifyOverrideSignature(
    overrideData: {
      userId: string;
      overrideType: string;
      reason: string;
      targetTaskId?: string;
      targetMode?: string;
      timestamp: string;
    },
    signature: string
  ): boolean {
    const expected = this.signOverridePayload(overrideData);
    if (!signature || signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  }

  /**
   * Computes a cryptographic SHA-256 fingerprint of the AppState for integrity audit
   */
  static computeStateChecksum(state: any): string {
    const stableRepresentation = JSON.stringify({
      version: state.version || 1,
      currentMode: state.currentMode,
      routineState: state.routineState,
      autonomyLevel: state.autonomyLevel,
      tasks: (state.tasks || []).map((t: any) => ({ id: t.id, completed: t.completed, status: t.executionStatus })),
      rewardPoints: state.rewardPoints || 0,
      deviationsCount: (state.deviations || []).length,
      overridesCount: (state.userOverrides || []).length,
    });

    return crypto.createHash('sha256').update(stableRepresentation).digest('hex');
  }

  /**
   * Deterministic symmetric payload encryption/decryption (AES-256-GCM)
   */
  static encryptSensitiveData(plaintext: string): { ciphertext: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(12);
    const secret = this.getMasterSecretKey();
    const key = crypto.scryptSync(secret, 'salt-hee-vault', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext: encrypted,
      iv: iv.toString('hex'),
      tag,
    };
  }

  static decryptSensitiveData(encryptedData: { ciphertext: string; iv: string; tag: string }): string {
    const secret = this.getMasterSecretKey();
    const key = crypto.scryptSync(secret, 'salt-hee-vault', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedData.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));

    let decrypted = decipher.update(encryptedData.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
